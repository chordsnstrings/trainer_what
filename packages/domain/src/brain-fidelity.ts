import { z } from "zod";
import { selectConversationContext } from "./conversation-context.ts";

export const FIDELITY_VERSION = "trainer-fidelity-v2";
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const exchangeTurn = z
  .object({
    author: z.enum(["subscriber", "trainer"]),
    text: text(3, 700),
  })
  .strict();
const completeExchanges = (turns: z.infer<typeof exchangeTurn>[]) =>
  turns.length % 2 === 0 &&
  turns.every((t, i) => t.author === (i % 2 ? "trainer" : "subscriber"));
export const fidelityRunSchema = z
  .object({
    approach: z.enum(["recall", "recent_only"]).default("recall"),
  })
  .strict();
export type FidelityApproach = z.infer<typeof fidelityRunSchema>["approach"];
export const fidelityDimensions = [
  "decision",
  "wording",
  "context",
  "reasoning",
  "boundaries",
] as const;
export const fidelityCaseSchema = z
  .object({
    title: text(3, 100),
    turns: z.array(exchangeTurn).min(2).max(6),
    history: z.array(exchangeTurn).max(6).default([]),
    request: text(5, 1200),
    referenceReply: text(3, 2000),
    referenceReason: text(3, 1000),
    expectHandover: z.boolean(),
    fictional: z.literal(true),
  })
  .strict()
  .refine(
    (c) => completeExchanges(c.turns) && completeExchanges(c.history),
    "Start with the subscriber and alternate complete exchanges before the new message.",
  )
  .refine(
    (c) =>
      c.turns.reduce((n, t) => n + t.text.length, c.request.length) <= 2400,
    "Keep the conversation and new message within 2,400 characters.",
  )
  .refine(
    (c) => c.history.reduce((n, t) => n + t.text.length, 0) <= 4000,
    "Keep older exchanges within 4,000 characters.",
  );
export type FidelityCase = z.infer<typeof fidelityCaseSchema>;
export const fidelityScoreSchema = z
  .object({
    label: z.enum(["A", "B"]),
    decision: z.number().int().min(1).max(5),
    wording: z.number().int().min(1).max(5),
    context: z.number().int().min(1).max(5),
    // Existing reviews remain readable; missing dimensions are never scored as zero.
    reasoning: z.number().int().min(1).max(5).optional(),
    boundaries: z.number().int().min(1).max(5).optional(),
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
type Situation = Pick<FidelityCase, "turns" | "request"> &
  Partial<Pick<FidelityCase, "history">>;
const exchangeText = (turns: FidelityCase["turns"]) =>
  turns.map(
    (t) => `${t.author === "subscriber" ? "Subscriber" : "Trainer"}: ${t.text}`,
  );
export const fidelitySituation = (c: Situation) =>
  [
    ...(c.history?.length
      ? [
          "Older conversation (20 days earlier):",
          ...exchangeText(c.history),
          "Recent conversation:",
        ]
      : []),
    ...exchangeText(c.turns),
    `Subscriber: ${c.request}`,
  ].join("\n");

/** Fixed fictional time keeps both approaches comparable even weeks after saving. */
export function fidelityConversation(
  c: Situation,
  createdAt: string,
  approach: FidelityApproach,
) {
  const now = Date.parse(createdAt);
  const rows = (turns: FidelityCase["turns"], age: number, prefix: string) =>
    turns.map((turn, i) => ({
      ...turn,
      id: `${prefix}-${i}`,
      version: 1,
      sentAt: new Date(now - age - (turns.length - i) * 60000).toISOString(),
    }));
  return selectConversationContext(
    [
      ...rows(c.history ?? [], 20 * 86400000, "older"),
      ...rows(c.turns, 0, "recent"),
    ],
    c.request,
    { now, recall: approach === "recall" },
  ).context;
}

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
