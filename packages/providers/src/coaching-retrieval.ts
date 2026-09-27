import { createHash } from "node:crypto";
import {
  canonicalCoaching,
  teachingCaseSchema,
} from "../../domain/src/coaching-completion.ts";

// Changes to ranking, projection or limits require a new version. The complete
// policy is part of the qualified runtime contract, for evaluation and delivery.
export const coachingRetrievalPolicy = Object.freeze({
  version: "coach-teaching-relevance-v1",
  maxCandidates: 100,
  maxExamples: 6,
  maxExampleChars: 18000,
  maxTotalChars: 24000,
  maxQueryTerms: 128,
});
const stopWords = new Set(
  "a an and are as at be been but by can could do for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this to was we were what when where which who will with would you your".split(
    " ",
  ),
);
function terms(value: string) {
  return new Set(
    (
      value
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((term) => term.length > 1 && !stopWords.has(term)),
  );
}
const fields = {
  scenario: 4,
  recommendation: 2,
  reason: 1,
  alternatives: 1,
  changeWhen: 2,
  escalateWhen: 2,
  outcomeContext: 1,
} as const;
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalCoaching(value)).digest("hex");

/** Local, bounded lexical retrieval; never reads outcomes, test cases or IDs as
 * query text. Tenant, approval and learning rights precede indexing/ranking. */
export function retrieveCoachingTeaching(input: {
  tenantId: string;
  request: string;
  facts: any;
  actions: any[];
  examples: any[];
}) {
  if (input.examples.length > coachingRetrievalPolicy.maxCandidates)
    throw Object.assign(new Error("Too many active coaching teaching cases"), {
      statusCode: 409,
    });
  const categories = new Set(input.actions.map((a) => a.data.type));
  const material = input.examples
    .filter(
      (row) =>
        row.tenant_id === input.tenantId &&
        row.kind === "coaching_teaching" &&
        row.status === "confirmed" &&
        row.data.allowedUses?.includes("model_prompt") &&
        row.data.allowedUses?.includes("trainer_specific_learning"),
    )
    .map((row) => {
      // Provenance, source outcome notes and future record fields cannot leak
      // through a generic data spread into the model prompt.
      const parsed = teachingCaseSchema.safeParse(
        Object.fromEntries(
          Object.keys(teachingCaseSchema.shape).map((key) => [
            key,
            row.data[key],
          ]),
        ),
      );
      if (!parsed.success) return null;
      return {
        id: row.id,
        version: row.version,
        data: {
          ...parsed.data,
          allowedUses: ["model_prompt", "trainer_specific_learning"],
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const documents = material
    .filter((row) => categories.has(row.data.category))
    .map((row) => ({
      row,
      fields: Object.entries(fields).map(([key, weight]) => ({
        weight,
        tokens: terms(row.data[key as keyof typeof fields] ?? ""),
      })),
      chars: JSON.stringify({ id: row.id, data: row.data }).length,
    }));
  const request = [...terms(input.request)].slice(
    0,
    coachingRetrievalPolicy.maxQueryTerms,
  );
  const facts = input.facts;
  const context = [
    ...terms(
      [
        facts.profile?.experience,
        facts.profile?.equipment,
        facts.program?.title,
        ...(facts.program?.exercises ?? []).map((e: any) => e.name),
        ...(facts.sets ?? []).map((s: any) => s.exercise),
      ]
        .filter((value) => typeof value === "string")
        .join(" "),
    ),
  ].slice(0, coachingRetrievalPolicy.maxQueryTerms);
  const query = new Map(context.map((term) => [term, 1]));
  request.forEach((term) => query.set(term, 3));
  const frequency = new Map(
    [...query.keys()].map((term) => [
      term,
      documents.filter((doc) =>
        doc.fields.some((field) => field.tokens.has(term)),
      ).length,
    ]),
  );
  const ranked = documents
    .map((doc) => {
      let score = 0;
      for (const [term, queryWeight] of query) {
        const rarity =
          1 + Math.log((documents.length + 1) / (frequency.get(term)! + 1));
        for (const field of doc.fields)
          if (field.tokens.has(term))
            score +=
              (queryWeight * field.weight * rarity) /
              Math.sqrt(Math.max(1, field.tokens.size));
      }
      return { ...doc, score: Math.round(score * 1e6) / 1e6 };
    })
    .filter((doc) => doc.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
    );
  const selected: typeof ranked = [];
  let chars = 2; // JSON array delimiters plus the full, untruncated examples.
  for (const doc of ranked) {
    const size = doc.chars + (selected.length ? 1 : 0);
    if (
      doc.chars > coachingRetrievalPolicy.maxExampleChars ||
      chars + size > coachingRetrievalPolicy.maxTotalChars
    )
      continue;
    selected.push(doc);
    chars += size;
    if (selected.length === coachingRetrievalPolicy.maxExamples) break;
  }
  return {
    examples: selected.map((doc) => doc.row),
    trace: {
      version: coachingRetrievalPolicy.version,
      materialDigest: hash(material),
      candidateCount: documents.length,
      examples: selected.map((doc) => ({
        id: doc.row.id,
        version: doc.row.version,
        score: doc.score,
      })),
      characters: chars,
    },
  };
}
