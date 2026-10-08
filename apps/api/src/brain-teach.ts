/**
 * Teach your Brain (setup step 4) and Keep training: rule cards with
 * "Approve all", the "Would you reply like this?" practice quiz, launch in
 * "Waits for me" mode, the "Brain trained" meter and more teaching after
 * launch. docs/features/brain-teach.md describes the API.
 */
import { randomUUID } from "node:crypto";
import { communicationDigest } from "./trainer-brain.ts";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, putRecord, type Actor, type Database, type Tx } from "@trainer/db";
import { MODEL_EVIDENCE_LIMIT } from "@trainer/providers";
import { generateQuizCases } from "../../../packages/providers/src/brain-quiz.ts";
import {
  BRAIN_LEVELS,
  OWN_CASES_FOR_FULL_CHECK,
  OWN_CASES_FOR_SUPERVISED,
  platformSafetyCasesFor,
  QUIZ_GENERATED_MAX,
  QUIZ_GENERATED_MIN,
  QUIZ_ROUND_MIN,
  QUIZ_SAFETY_MAX,
  QUIZ_SAFETY_MIN,
} from "../../../packages/domain/src/brain-teach.ts";
import { screenSafety } from "../../../packages/domain/src/safety-policy.ts";
import { activeSafetyPolicy } from "./safety-policy.ts";
import { modelAccounting } from "./model-accounting.ts";
import { privacyMatches } from "./ingestion.ts";
import {
  brainTrainingState,
  confirmedRulesDigest,
  type BrainTrainingState,
} from "./brain-training-state.ts";

const uuid = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const RELEASE_RULE_LIMIT = MODEL_EVIDENCE_LIMIT - 2;
const TEACHING_USES = ["model_prompt", "trainer_specific_learning"];

type Compile = (
  a: any,
  sourceIds: string[],
) => Promise<{ rules: any[]; conflicts: number; coverage: unknown }>;

const ruleCard = (r: any) => ({
  id: r.id,
  version: r.version,
  status: r.status as "draft" | "confirmed",
  title: r.data.title,
  category: r.data.category,
  condition: r.data.condition,
  directive: r.data.directive,
  reason: r.data.reason ?? "",
  flags: (r.data.flags ?? []) as string[],
  warning: !!r.data.flags?.length,
  origin: r.data.origin ?? "coach",
});
/** The round as the coach sees it: questions, suggested replies and answers. */
const roundView = (r: any) => ({
  id: r.id,
  version: r.version,
  status: r.status as "open" | "completed",
  index: r.data.index,
  createdAt: r.created_at,
  completedAt: r.data.completedAt ?? null,
  answered: r.data.cases.filter((c: any) => c.answer).length,
  total: r.data.cases.length,
  cases: r.data.cases.map((c: any) => ({
    id: c.id,
    source: c.source as "rule" | "platform",
    ruleId: c.ruleId ?? null,
    message: c.message,
    route: c.route as "reply" | "escalate",
    reply: c.reply,
    answer: c.answer
      ? { verdict: c.answer.verdict, reply: c.answer.reply ?? null }
      : null,
  })),
});
const normalized = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Word-set overlap, so a practice question never repeats a held-out case. */
function similar(a: string, b: string) {
  const x = new Set(normalized(a).split(" ").filter((w) => w.length > 2));
  const y = new Set(normalized(b).split(" ").filter((w) => w.length > 2));
  if (!x.size || !y.size) return normalized(a) === normalized(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.8;
}
function launchState(s: BrainTrainingState) {
  const supervised: string[] = [];
  if (!s.confirmed.length) supervised.push("Approve at least one rule.");
  if (s.confirmed.length > RELEASE_RULE_LIMIT)
    supervised.push(
      `Keep at most ${RELEASE_RULE_LIMIT} approved rules; return extra rules to draft.`,
    );
  if (s.openConflicts) supervised.push("Settle the rules that disagree.");
  if (!s.completedRounds.length) supervised.push("Finish a practice quiz.");
  if (s.ownCases.length < OWN_CASES_FOR_SUPERVISED)
    supervised.push(
      `Write ${OWN_CASES_FOR_SUPERVISED - s.ownCases.length} more of your own client questions.`,
    );
  const automatic: string[] = [];
  if (s.ownCases.length < OWN_CASES_FOR_FULL_CHECK)
    automatic.push(
      `Write at least ${OWN_CASES_FOR_FULL_CHECK} of your own client questions (you have ${s.ownCases.length}).`,
    );
  if (!s.fullCheck) automatic.push("Pass the full check of your current rules.");
  const live =
    !!s.release &&
    confirmedRulesDigest(s.release.data.rules ?? []) === s.rulesDigest &&
    communicationDigest(s.release.data.communication) === s.communicationDigest;
  return {
    live,
    liveMode: s.release
      ? s.release.data.qualification === "quiz"
        ? "waits_for_me"
        : "checked"
      : null,
    supervised: { ready: !supervised.length, missing: supervised },
    automatic: { ready: !automatic.length, missing: automatic },
  };
}
function overview(s: BrainTrainingState) {
  return {
    rules: s.rules
      .filter((r) => r.status === "draft" || r.status === "confirmed")
      .map(ruleCard),
    approveAll: s.drafts
      .filter((r) => !r.data.flags?.length)
      .map((r) => ({ id: r.id, version: r.version })),
    flaggedDrafts: s.drafts.filter((r) => r.data.flags?.length).length,
    quiz: {
      open: s.openRound ? roundView(s.openRound) : null,
      completedRounds: s.completedRounds.length,
    },
    ownCases: {
      count: s.ownCases.length,
      forWaitsForMe: OWN_CASES_FOR_SUPERVISED,
      forSendsAutomatically: OWN_CASES_FOR_FULL_CHECK,
    },
    meter: s.meter,
    levels: BRAIN_LEVELS,
    launch: launchState(s),
    suggestions: {
      drafts: s.drafts.length,
      teaching: s.uncompiledTeaching.length,
      replyCorrections: s.unconvertedCorrections.length,
      /** GET /brain/suggestions: rules suggested from corrected replies. */
      learned: s.learnedSuggestions.length,
    },
  };
}

export function registerBrainTeaching(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
  deps: { compile: Compile },
) {
  const trainer = (req: FastifyRequest) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "ROLE_REQUIRED", "Trainer access required");
    return a;
  };
  const owner = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(403, "OWNER_REQUIRED", "Only the trainer owner can do this");
    return a;
  };
  const brainLock = (tx: Tx, a: Actor) =>
    tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":brain",
    ]);

  app.get("/api/v1/brain/teach", async (req) => {
    const a = trainer(req);
    return db.tenant(a, async (tx) => overview(await brainTrainingState(tx)));
  });

  // Approve every warning-free draft rule the coach was shown. Flagged rules
  // are skipped and stay one-by-one (POST /brain/rules/:id/confirm).
  app.post("/api/v1/brain/rules/approve-all", async (req) => {
    const a = owner(req),
      b = z
        .object({
          rules: z
            .array(z.object({ id: uuid, version: z.number().int().positive() }).strict())
            .min(1)
            .max(100)
            .refine((l) => new Set(l.map((r) => r.id)).size === l.length),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await brainLock(tx, a);
      const rows = await tx.query(
        "SELECT * FROM records WHERE kind='rule' AND id=ANY($1::uuid[]) FOR UPDATE",
        [b.rules.map((r) => r.id)],
      );
      const approved: string[] = [];
      const skipped: Array<{ id: string; reason: string }> = [];
      const at = new Date().toISOString();
      for (const shown of b.rules) {
        const r = rows.find((x) => x.id === shown.id);
        if (!r) skipped.push({ id: shown.id, reason: "not_found" });
        else if (r.status === "confirmed")
          skipped.push({ id: r.id, reason: "already_approved" });
        else if (r.status !== "draft")
          skipped.push({ id: r.id, reason: "not_a_draft" });
        else if (r.version !== shown.version)
          skipped.push({ id: r.id, reason: "changed" });
        else if (r.data.flags?.length)
          skipped.push({ id: r.id, reason: "flagged" });
        else {
          await tx.query(
            "UPDATE records SET status='confirmed',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
            [
              r.id,
              JSON.stringify({ confirmedBy: a.userId, confirmedAt: at, bulk: true }),
            ],
          );
          await event(tx, a, "brain.rule_confirmed", r.id, { bulk: true });
          approved.push(r.id);
        }
      }
      return { approved, skipped };
    });
  });

  // Start a practice quiz round, or return the round already open.
  app.post("/api/v1/brain/quiz/rounds", async (req) => {
    const a = owner(req);
    const prepared = await db.tenant(a, async (tx) => {
      const s = await brainTrainingState(tx);
      if (s.openRound) return { open: s.openRound };
      if (!s.confirmed.length)
        throw fail(
          409,
          "RULES_REQUIRED",
          "Approve at least one rule before the practice quiz.",
        );
      if (s.confirmed.length > RELEASE_RULE_LIMIT)
        throw fail(
          409,
          "RULE_LIMIT",
          `Keep at most ${RELEASE_RULE_LIMIT} approved rules before the practice quiz.`,
        );
      // Rules the earlier rounds asked about least go first.
      const asked = new Map<string, number>();
      for (const round of s.rounds)
        for (const c of round.data.cases ?? [])
          if (c.ruleId) asked.set(c.ruleId, (asked.get(c.ruleId) ?? 0) + 1);
      const rules = [...s.confirmed].sort(
        (x, y) =>
          (asked.get(x.id) ?? 0) - (asked.get(y.id) ?? 0) ||
          x.id.localeCompare(y.id),
      );
      return {
        rules,
        digest: s.rulesDigest,
        index: s.rounds.length,
        heldOut: s.ownCases.map((c) => String(c.data.prompt ?? "")),
        policy: await activeSafetyPolicy(tx),
      };
    });
    if ("open" in prepared) return roundView(prepared.open);
    const needsCoach = (text: string) => {
      const screen = screenSafety(text, prepared.policy);
      return screen.hold || screen.review;
    };
    const count = Math.min(
      QUIZ_GENERATED_MAX,
      Math.max(QUIZ_GENERATED_MIN, prepared.rules.length * 2),
    );
    const generated = await generateQuizCases(
      prepared.rules.map((r) => ({ id: r.id, data: r.data })),
      count,
      needsCoach,
      modelAccounting(db, a, "brain_quiz"),
    );
    const usable = generated.cases.filter(
      (c) => !prepared.heldOut.some((h) => similar(h, c.message)),
    );
    if (usable.length < QUIZ_GENERATED_MIN)
      throw fail(
        502,
        "QUIZ_UNAVAILABLE",
        "Your practice questions could not be drafted this time. Please try again.",
      );
    const safety = platformSafetyCasesFor(
      prepared.index,
      Math.min(QUIZ_SAFETY_MAX, Math.max(QUIZ_SAFETY_MIN, QUIZ_ROUND_MIN - usable.length)),
    );
    const versions = new Map(prepared.rules.map((r) => [r.id, r.version]));
    const ruleCases = usable.map((c) => ({
      id: randomUUID(),
      source: "rule" as const,
      ruleId: c.ruleId,
      ruleVersion: versions.get(c.ruleId),
      message: c.message,
      route: c.route,
      reply: c.reply,
    }));
    const safetyCases = safety.map((c) => ({
      id: randomUUID(),
      source: "platform" as const,
      platformKey: c.key,
      message: c.message,
      route: "escalate" as const,
      reply: c.reply,
    }));
    // A safety question after every two or three rule questions.
    const cases: Array<(typeof ruleCases)[number] | (typeof safetyCases)[number]> = [];
    const gap = Math.max(1, Math.round(ruleCases.length / safetyCases.length));
    let s = 0;
    ruleCases.forEach((c, i) => {
      cases.push(c);
      if ((i + 1) % gap === 0 && s < safetyCases.length) cases.push(safetyCases[s++]);
    });
    while (s < safetyCases.length) cases.push(safetyCases[s++]);
    return db.tenant(a, async (tx) => {
      await brainLock(tx, a);
      const current = await brainTrainingState(tx);
      if (current.openRound) return roundView(current.openRound);
      if (current.rulesDigest !== prepared.digest)
        throw fail(
          409,
          "TEACHING_CHANGED",
          "Your rules changed while the quiz was being drafted. Start the quiz again.",
        );
      const round = await putRecord(
        tx,
        a,
        "brain_quiz_round",
        {
          index: prepared.index,
          cases,
          rulesDigest: prepared.digest,
          promptVersion: generated.promptVersion,
          requested: generated.requested,
          rejected: generated.rejected.length,
        },
        { status: "open" },
      );
      await event(tx, a, "brain.quiz_started", round.id, {
        cases: cases.length,
        platform: safetyCases.length,
      });
      return roundView(round);
    });
  });

  app.get("/api/v1/brain/quiz/rounds/:id", async (req) => {
    const a = trainer(req);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='brain_quiz_round'",
        [uuid.parse((req.params as any).id)],
      );
      if (!r) throw fail(404, "NOT_FOUND", "This quiz is unavailable");
      return roundView(r);
    });
  });

  // "Would you reply like this?" Yes or Change. Every answer is kept as the
  // coach's teaching; a changed reply to a rule question can become a rule.
  app.post("/api/v1/brain/quiz/rounds/:id/answers", async (req) => {
    const a = owner(req),
      b = z
        .object({
          caseId: uuid,
          verdict: z.enum(["yes", "change"]),
          reply: z.string().trim().min(3).max(4000).optional(),
        })
        .strict()
        .refine((v) => v.verdict === "yes" || !!v.reply, {
          message: "Write how you would reply",
          path: ["reply"],
        })
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await brainLock(tx, a);
      const [round] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='brain_quiz_round' FOR UPDATE",
        [uuid.parse((req.params as any).id)],
      );
      if (!round) throw fail(404, "NOT_FOUND", "This quiz is unavailable");
      const cases = round.data.cases as any[];
      const c = cases.find((x) => x.id === b.caseId);
      if (!c) throw fail(404, "NOT_FOUND", "This question is unavailable");
      const reply = b.verdict === "change" ? b.reply! : undefined;
      if (c.answer) {
        if (c.answer.verdict === b.verdict && (c.answer.reply ?? undefined) === reply)
          return roundView(round);
        throw fail(409, "ALREADY_ANSWERED", "You already answered this question");
      }
      if (round.status !== "open")
        throw fail(409, "QUIZ_CLOSED", "This quiz is finished");
      const suggested =
        c.route === "escalate"
          ? `Pass it to me with this holding reply: "${c.reply}"`
          : `Reply: "${c.reply}"`;
      const teaching = await putRecord(
        tx,
        a,
        "interview",
        {
          question: `Practice question. A client writes: "${c.message}". ${suggested}. Would I reply like this?`.slice(0, 3000),
          answer:
            b.verdict === "yes"
              ? `Yes, I would reply like this: "${c.reply}"`
              : `No. I would reply: "${reply}"`,
          origin: "quiz",
          source: c.source,
          verdict: b.verdict,
          route: c.route,
          quizRoundId: round.id,
          caseId: c.id,
          ...(c.ruleId ? { ruleId: c.ruleId } : {}),
          ...(c.platformKey ? { platformKey: c.platformKey } : {}),
          allowedUses: TEACHING_USES,
        },
        { status: "answered" },
      );
      c.answer = {
        verdict: b.verdict,
        ...(reply ? { reply } : {}),
        teachingId: teaching.id,
        at: new Date().toISOString(),
      };
      const done = cases.every((x) => x.answer);
      const data = {
        ...round.data,
        cases,
        ...(done ? { completedAt: new Date().toISOString() } : {}),
      };
      const [updated] = await tx.query(
        "UPDATE records SET data=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [round.id, JSON.stringify(data), done ? "completed" : "open"],
      );
      await event(tx, a, "brain.quiz_answered", round.id, {
        verdict: b.verdict,
        source: c.source,
      });
      if (done)
        await event(tx, a, "brain.quiz_completed", round.id, {
          changed: cases.filter((x) => x.answer.verdict === "change").length,
        });
      return roundView(updated);
    });
  });

  // Go live in "Waits for me": every reply is a draft the coach approves.
  // "Sends automatically" still needs the full check (POST /brain/releases
  // with a passing evaluation, then /brain/coaching-activate).
  app.post("/api/v1/brain/releases/supervised", async (req) => {
    const a = owner(req),
      b = z
        .object({ notes: z.string().max(2000).default("") })
        .strict()
        .parse(req.body ?? {});
    return db.tenant(a, async (tx) => {
      await brainLock(tx, a);
      const s = await brainTrainingState(tx);
      const launch = launchState(s);
      if (!launch.supervised.ready)
        throw fail(409, "TEACHING_REQUIRED", launch.supervised.missing.join(" "));
      if (launch.live && s.release!.data.qualification === "quiz")
        return s.release;
      await tx.query(
        "UPDATE records SET status='archived' WHERE kind='brain_release' AND status='published'",
      );
      const release = await putRecord(
        tx,
        a,
        "brain_release",
        {
          rules: s.confirmed.map((r) => ({ id: r.id, data: r.data, version: r.version })),
          communication: s.communication,
          notes: b.notes,
          mode: "supervised",
          qualification: "quiz",
          quizRoundId: s.completedRounds.at(-1)!.id,
          ownCaseIds: s.ownCases.map((c) => c.id),
        },
        { status: "published" },
      );
      await event(tx, a, "brain.release_published", release.id, {
        qualification: "quiz",
      });
      return release;
    });
  });

  // Keep training: a rule in the coach's own words, drafted through the
  // existing rule compile (draft rules with warnings, conflicts).
  app.post("/api/v1/brain/teach/chat", async (req) => {
    const a = owner(req),
      b = z
        .object({ text: z.string().trim().min(10).max(12000) })
        .strict()
        .parse(req.body);
    if (privacyMatches(b.text).length)
      throw fail(
        400,
        "PERSONAL_DATA_REMAINS",
        "Remove client names and contact details before teaching your Brain.",
      );
    const interview = await db.tenant(a, async (tx) => {
      const r = await putRecord(
        tx,
        a,
        "interview",
        {
          question: "Keep training: a rule in my own words",
          answer: b.text,
          origin: "keep_training_chat",
          allowedUses: TEACHING_USES,
        },
        { status: "answered" },
      );
      await event(tx, a, "brain.interview_answered", r.id);
      return r;
    });
    const compiled = await deps.compile(a, [interview.id]);
    return { teachingId: interview.id, ...compiled };
  });

  app.get("/api/v1/brain/teach/suggestions", async (req) => {
    const a = trainer(req);
    return db.tenant(a, async (tx) => {
      const s = await brainTrainingState(tx);
      return {
        rules: s.drafts.map(ruleCard),
        teaching: s.uncompiledTeaching.map((i) => ({
          id: i.id,
          origin: i.data.origin,
          question: i.data.question,
          answer: i.data.answer,
          createdAt: i.created_at,
        })),
        // Only the coach's own words; the client's message is not shown or
        // used as teaching material.
        replyCorrections: s.unconvertedCorrections.map((c) => ({
          id: c.id,
          category: c.data.category ?? null,
          reply: String(c.data.preferred?.message ?? ""),
          explanation: c.data.explanation ?? null,
          createdAt: c.created_at,
        })),
      };
    });
  });

  // Turn teaching (quiz changes, chat, corrected real replies) into draft
  // rules through the existing compile. Nothing is confirmed here.
  app.post("/api/v1/brain/teach/suggestions/compile", async (req) => {
    const a = owner(req),
      b = z
        .object({
          teachingIds: z.array(uuid).max(20).default([]),
          correctionIds: z.array(uuid).max(20).default([]),
        })
        .strict()
        .refine((v) => v.teachingIds.length + v.correctionIds.length > 0)
        .refine((v) => v.teachingIds.length + v.correctionIds.length <= 20)
        .parse(req.body);
    const ids = await db.tenant(a, async (tx) => {
      const s = await brainTrainingState(tx);
      const teaching = new Set(s.uncompiledTeaching.map((i) => i.id));
      for (const t of b.teachingIds)
        if (!teaching.has(t))
          throw fail(409, "SUGGESTION_UNAVAILABLE", "This teaching is not waiting to become a rule");
      const out = [...b.teachingIds];
      for (const cid of b.correctionIds) {
        const c = s.unconvertedCorrections.find((x) => x.id === cid);
        if (!c)
          throw fail(409, "SUGGESTION_UNAVAILABLE", "This correction is not waiting to become a rule");
        const text = [
          `How I want replies like this written: "${String(c.data.preferred?.message ?? "")}"`,
          c.data.explanation ? `Why: ${c.data.explanation}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (privacyMatches(text).length)
          throw fail(
            400,
            "PERSONAL_DATA_REMAINS",
            "This corrected reply names a client or contact details. Teach the rule in your own words instead.",
          );
        const r = await putRecord(
          tx,
          a,
          "interview",
          {
            question: `A corrected reply (${c.data.category ?? "reply"})`,
            answer: text.slice(0, 12000),
            origin: "reply_correction",
            correctionId: c.id,
            allowedUses: TEACHING_USES,
          },
          { status: "answered" },
        );
        out.push(r.id);
      }
      return out;
    });
    return deps.compile(a, ids);
  });
}
