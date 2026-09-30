/**
 * Keep training: the coach's corrections of real Brain replies become
 * suggested rules the coach confirms. An edit before sending
 * (`POST /exceptions/:id/corrections`) or a rejected draft
 * (`POST /exceptions/:id/resolve` without sending it) queues a
 * `brain_learning` job; the job asks the model for at most one narrow rule
 * (prompt brain-correction-v1) and keeps it only when the code checks pass.
 * Suggestions are workspace records owned by the client the correction was
 * about, so they are erased with that client; a confirmed rule keeps only
 * the checked rule text. docs/features/brain-check.md describes the API.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  elevated,
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { ModelOutputInvalid } from "@trainer/providers";
import {
  RULE_CATEGORIES,
  suggestionIssues,
  withoutName,
  type CorrectionMaterial,
} from "../../../packages/domain/src/brain-learning.ts";
import { suggestRuleFromCorrection } from "../../../packages/providers/src/brain-learning.ts";
import { screenSafety } from "../../../packages/domain/src/safety-policy.ts";
import { activeSafetyPolicy } from "./safety-policy.ts";
import { modelAccounting } from "./model-accounting.ts";
import { privacyMatches } from "./ingestion.ts";
import { requestBrainCheck } from "./brain-check.ts";
import { RELEASE_RULE_LIMIT } from "./brain-replies-check.ts";

export const BRAIN_LEARNING_JOB = "brain_learning";
const uuid = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * Queues learning from one reviewed exception (runs in the reviewer's
 * workspace scope). `userId` is the client, so a pending job is erased with
 * the client's data.
 */
export async function requestCorrectionLearning(
  tx: Tx,
  a: Actor,
  exceptionId: string,
  kind: "edit" | "rejection",
) {
  const [exception] = await tx.query(
    "SELECT id,owner_user_id,data FROM records WHERE id=$1 AND kind='exception'",
    [exceptionId],
  );
  if (!exception?.data?.decisionId) return;
  await tx.query(
    `INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'${BRAIN_LEARNING_JOB}',$3,$4) ON CONFLICT(intent_key) DO NOTHING`,
    [
      randomUUID(),
      a.tenantId,
      `${BRAIN_LEARNING_JOB}:${exception.id}:${kind}`,
      JSON.stringify({ exceptionId: exception.id, kind, userId: exception.owner_user_id }),
    ],
  );
}

const ruleText = (r: { title: string; condition: string; directive: string }) =>
  `${r.title}. ${r.condition}. ${r.directive}`;

/** Worker entry point: one correction becomes one suggestion record (or none). */
export async function executeBrainLearningJob(db: Database, tenantId: string, job: any) {
  const a = elevated("worker", { tenantId, role: "owner" });
  const exceptionId = uuid.parse(job.data.exceptionId);
  const kind: "edit" | "rejection" = job.data.kind === "rejection" ? "rejection" : "edit";
  const prepared = await db.tenant(a, async (tx) => {
    const [exception] = await tx.query(
      "SELECT * FROM records WHERE id=$1 AND kind='exception'",
      [exceptionId],
    );
    if (!exception) return null;
    const [done] = await tx.query(
      "SELECT id FROM records WHERE kind='brain_suggestion' AND data->'source'->>'exceptionId'=$1 AND data->'source'->>'kind'=$2",
      [exceptionId, kind],
    );
    if (done) return null;
    let material: CorrectionMaterial, source: Record<string, unknown>;
    if (kind === "edit") {
      const [c] = await tx.query(
        "SELECT * FROM records WHERE kind='coaching_correction' AND data->>'exceptionId'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
        [exceptionId],
      );
      if (!c) return null;
      material = {
        kind,
        category: c.data.category ?? null,
        draft: String(c.data.rejected?.message ?? ""),
        coachReply: String(c.data.preferred?.message ?? ""),
        coachNote: c.data.explanation ?? null,
      };
      source = { kind, exceptionId, correctionId: c.id };
    } else {
      if (exception.status !== "resolved" || !exception.data.decisionId) return null;
      const [d] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='decision'",
        [exception.data.decisionId],
      );
      // A draft that was sent in the end is not a rejection.
      if (!d || d.status === "delivered") return null;
      material = {
        kind,
        category: d.data.type ?? null,
        draft: String(d.data.message ?? ""),
        coachReply: null,
        coachNote: String(exception.data.resolution ?? ""),
      };
      source = { kind, exceptionId, decisionId: d.id };
    }
    if (!material.draft.trim()) return null;
    const [client] = await tx.query("SELECT name FROM users WHERE id=$1", [
      exception.owner_user_id,
    ]);
    const names = [client?.name ?? ""];
    const clean: CorrectionMaterial = {
      ...material,
      draft: withoutName(material.draft, names),
      coachReply: material.coachReply === null ? null : withoutName(material.coachReply, names),
      coachNote: material.coachNote === null ? null : withoutName(material.coachNote, names),
    };
    const policy = await activeSafetyPolicy(tx);
    return {
      material: clean,
      source,
      clientId: exception.owner_user_id as string,
      names,
      policy,
      personal: [clean.draft, clean.coachReply ?? "", clean.coachNote ?? ""].some(
        (t) => privacyMatches(t).length > 0,
      ),
    };
  });
  if (!prepared) return null;
  const store = (data: Record<string, unknown>, status: string) =>
    db.tenant(a, async (tx) => {
      const [done] = await tx.query(
        "SELECT id FROM records WHERE kind='brain_suggestion' AND data->'source'->>'exceptionId'=$1 AND data->'source'->>'kind'=$2",
        [exceptionId, kind],
      );
      if (done) return done;
      const row = await putRecord(
        tx,
        a,
        "brain_suggestion",
        {
          source: prepared.source,
          category: prepared.material.category,
          example: {
            draft: prepared.material.draft,
            coachReply: prepared.material.coachReply,
            coachNote: prepared.material.coachNote,
          },
          ...data,
        },
        { ownerId: prepared.clientId, status },
      );
      await event(tx, a, "brain.suggestion_created", row.id, { status });
      return row;
    });
  // Contact details or account numbers in the texts: nothing is sent; the
  // coach can still teach the rule in their own words.
  if (prepared.personal)
    return store({ issues: ["personal_data"], rule: null, why: "" }, "withheld");
  const redFlag = (text: string) => screenSafety(text, prepared.policy).hold;
  let result;
  try {
    result = await suggestRuleFromCorrection(
      prepared.material,
      modelAccounting(db, a, "brain_correction", { memberId: null }),
      redFlag,
    );
  } catch (error) {
    if (!(error instanceof ModelOutputInvalid)) throw error;
    return store({ issues: ["invalid_model_answer"], rule: null, why: "" }, "withheld");
  }
  const issues: string[] = [...result.issues];
  if (
    result.rule &&
    (privacyMatches(ruleText(result.rule)).length ||
      withoutName(ruleText(result.rule), prepared.names) !== ruleText(result.rule))
  )
    issues.push("personal_data");
  return store(
    {
      rule: result.rule,
      why: result.why.slice(0, 600),
      issues,
      promptVersion: result.promptVersion,
    },
    !result.learn || !result.rule ? "nothing_to_learn" : issues.length ? "withheld" : "suggested",
  );
}

const suggestionView = (r: any) => ({
  id: r.id,
  version: r.version,
  status: r.status,
  source: r.data.source?.kind === "rejection" ? "rejection" : "edit",
  rule: r.data.rule,
  why: r.data.why ?? "",
  example: r.data.example ?? null,
  createdAt: r.created_at,
});

export function registerBrainLearning(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
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
  // A reviewed draft (edited and sent, or not sent) queues learning from it.
  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode >= 300 || req.method !== "POST") return payload;
    const a = (req as any).identity as Actor | undefined;
    if (!a || !["owner", "staff"].includes(a.role)) return payload;
    const path = req.url.split("?")[0];
    const edit = /^\/api\/v1\/exceptions\/([^/]+)\/corrections$/.exec(path);
    const resolved = /^\/api\/v1\/exceptions\/([^/]+)\/resolve$/.exec(path);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const match = edit ?? (resolved && body.approveDecision !== true ? resolved : null);
    if (!match || !uuid.safeParse(match[1]).success) return payload;
    try {
      await db.tenant(a, (tx) =>
        requestCorrectionLearning(tx, a, match[1], edit ? "edit" : "rejection"),
      );
    } catch (error) {
      req.log.warn({ err: error }, "Learning from a correction could not be queued");
    }
    return payload;
  });

  app.get("/api/v1/brain/suggestions", async (req) => {
    const a = trainer(req);
    return db.tenant(a, async (tx) => {
      const rows = await tx.query(
        "SELECT id,version,status,data,created_at FROM records WHERE kind='brain_suggestion' ORDER BY created_at DESC,id DESC LIMIT 200",
      );
      const count = (status: string) => rows.filter((r) => r.status === status).length;
      return {
        suggestions: rows.filter((r) => r.status === "suggested").map(suggestionView),
        counts: {
          suggested: count("suggested"),
          confirmed: count("confirmed"),
          dismissed: count("dismissed"),
          nothingToLearn: count("nothing_to_learn"),
          withheld: count("withheld"),
        },
      };
    });
  });

  // Confirming makes it an approved rule (the coach may edit the wording
  // first). The same checks run again on the confirmed text; a warning is
  // never waved through here: teach it in your own words instead.
  app.post("/api/v1/brain/suggestions/:id/confirm", async (req) => {
    const a = owner(req),
      b = z
        .object({
          version: z.number().int().positive(),
          rule: z
            .object({
              title: z.string().trim().min(3).max(150),
              category: z.enum(RULE_CATEGORIES),
              condition: z.string().trim().min(3).max(1000),
              directive: z.string().trim().min(3).max(2000),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":brain"]);
      const [s] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='brain_suggestion' FOR UPDATE",
        [uuid.parse((req.params as any).id)],
      );
      if (!s) throw fail(404, "NOT_FOUND", "This suggestion is unavailable");
      if (s.version !== b.version || s.status !== "suggested")
        throw fail(409, "SUGGESTION_CHANGED", "This suggestion changed; refresh first");
      const rule = b.rule ?? s.data.rule;
      const policy = await activeSafetyPolicy(tx);
      const issues: string[] = suggestionIssues(
        rule,
        {
          kind: s.data.source?.kind === "rejection" ? "rejection" : "edit",
          category: s.data.category ?? null,
          draft: String(s.data.example?.draft ?? ""),
          // An edit the coach types now is their own wording too.
          coachReply: [s.data.example?.coachReply ?? "", b.rule ? ruleText(b.rule) : ""].join(" "),
          coachNote: s.data.example?.coachNote ?? null,
        },
        (text) => screenSafety(text, policy).hold,
      );
      if (privacyMatches(ruleText(rule)).length) issues.push("personal_data");
      if (issues.length)
        throw fail(
          409,
          "SUGGESTION_FLAGGED",
          `This rule needs changes before it can be approved (${issues.join(", ").replaceAll("_", " ")}). Teach it in your own words instead.`,
        );
      const [count] = await tx.query(
        "SELECT count(*)::int AS n FROM records WHERE kind='rule' AND status='confirmed'",
      );
      if (count.n >= RELEASE_RULE_LIMIT)
        throw fail(409, "RULE_LIMIT", `Keep at most ${RELEASE_RULE_LIMIT} approved rules; return a rule to draft first.`);
      const created = await putRecord(
        tx,
        a,
        "rule",
        {
          title: rule.title,
          category: rule.category,
          condition: rule.condition,
          directive: rule.directive,
          reason: String(s.data.why ?? "").slice(0, 2000),
          sourceIds: [],
          origin: "reply_correction",
          learnedFrom: s.id,
          allowedUses: ["render", "model_prompt", "trainer_specific_learning"],
          confirmedBy: a.userId,
          confirmedAt: new Date().toISOString(),
        },
        { status: "confirmed" },
      );
      await tx.query(
        "UPDATE records SET status='confirmed',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1",
        [s.id, JSON.stringify({ ruleId: created.id, edited: !!b.rule })],
      );
      await event(tx, a, "brain.suggestion_confirmed", s.id, { ruleId: created.id });
      await event(tx, a, "brain.rule_confirmed", created.id);
      await requestBrainCheck(tx, a, "suggestion_confirmed");
      return { rule: created, suggestionId: s.id };
    });
  });

  app.post("/api/v1/brain/suggestions/:id/dismiss", async (req) => {
    const a = owner(req),
      b = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      const rows = await tx.query(
        "UPDATE records SET status='dismissed',version=version+1,updated_at=now() WHERE id=$1 AND kind='brain_suggestion' AND status='suggested' AND version=$2 RETURNING id",
        [uuid.parse((req.params as any).id), b.version],
      );
      if (!rows.length) throw fail(409, "SUGGESTION_CHANGED", "This suggestion changed; refresh first");
      await event(tx, a, "brain.suggestion_dismissed", rows[0].id);
      return { ok: true };
    });
  });
}
