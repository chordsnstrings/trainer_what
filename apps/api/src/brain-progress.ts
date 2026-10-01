/**
 * "Getting better": a coach-only view of how the coach's Brain improves
 * (docs/features/brain-learning.md). Per week for the last 8 weeks: the share
 * of Brain drafts (plans and replies) the coach approved without edits, the
 * hand-off rate (work that went to the coach instead of being sent, and reply
 * drafts that hand the member over), and the median edit size; plus the
 * held-out pass rate of every check per version. Read-only, workspace-scoped,
 * never part of any public or marketing page. Also the code-built memory of
 * one member, so the coach sees what the Brain knows about them.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database } from "@trainer/db";
import { loadMemberMemory } from "./member-memory.ts";
import { publishedLearningSnapshot, waitingLearning } from "./brain-plans.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export const PROGRESS_WEEKS = 8;

const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);
/** Share of words changed between a draft and what the coach sent (0 to 1). */
export function wordChange(before: string, after: string) {
  const words = (t: string) => String(t ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const a = words(before),
    b = words(after);
  if (!a.length && !b.length) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let same = 0;
  for (const w of b) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      same++;
      counts.set(w, n - 1);
    }
  }
  return Math.round((1 - same / Math.max(a.length, b.length)) * 1000) / 1000;
}
/** Monday (UTC) of the week holding `at`, as YYYY-MM-DD. */
export function weekStart(at: Date | string) {
  const d = new Date(at);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export function registerBrainProgress(
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

  app.get("/api/v1/brain/progress", async (req) => {
    const a = trainer(req);
    const first = weekStart(new Date(Date.now() - (PROGRESS_WEEKS - 1) * 7 * 86400000));
    return db.tenant(a, async (tx) => {
      const learned = await tx.query(
        "SELECT data->>'decision' AS decision,jsonb_array_length(coalesce(data->'diff','[]'::jsonb)) AS changes,created_at FROM records WHERE kind='plan_learning' AND created_at>=$1::date",
        [first],
      );
      const generated = await tx.query(
        "SELECT data->>'route' AS route,data->'outcome'->>'decision' AS decision,created_at FROM records WHERE kind='plan_generation' AND created_at>=$1::date AND status IN ('delivered','pending_review','reviewed','approved','rejected','superseded','failed')",
        [first],
      );
      const drafts = await tx.query(
        `SELECT e.id,e.status,e.created_at,d.status AS decision_status,d.data->>'type' AS type,
           (SELECT c.data FROM records c WHERE c.kind='coaching_correction' AND c.data->>'exceptionId'=e.id::text ORDER BY c.created_at DESC LIMIT 1) AS correction
         FROM records e LEFT JOIN records d ON d.kind='decision' AND d.id::text=e.data->>'decisionId'
         WHERE e.kind='exception' AND e.data ? 'decisionId' AND e.created_at>=$1::date`,
        [first],
      );
      const checks = await tx.query(
        `SELECT kind,id,status,created_at,(data->>'passed')::int AS passed,(data->>'total')::int AS total,
           coalesce(data->>'brainReleaseId',data->>'releaseId',data->>'brainId') AS version
         FROM records WHERE kind IN ('evaluation','coaching_evaluation','plan_qualification','nutrition_evaluation') AND created_at>=$1::date
         ORDER BY created_at DESC,id DESC LIMIT 60`,
        [first],
      );
      const weeks = Array.from({ length: PROGRESS_WEEKS }, (_, i) =>
        weekStart(new Date(Date.parse(first + "T12:00:00Z") + i * 7 * 86400000)),
      );
      const inWeek = (rows: any[], w: string) => rows.filter((r) => weekStart(r.created_at) === w);
      const area: Record<string, string> = {
        evaluation: "replies",
        coaching_evaluation: "actions",
        plan_qualification: "plans",
        nutrition_evaluation: "nutrition",
      };
      const snapshot = await publishedLearningSnapshot(tx);
      const { waiting } = await waitingLearning(tx);
      return {
        weeks: weeks.map((w) => {
          const l = inWeek(learned, w),
            g = inWeek(generated, w),
            d = inWeek(drafts, w);
          const plans = {
            reviewed: l.length,
            approvedAsIs: l.filter((r) => r.decision === "approved").length,
            edited: l.filter((r) => r.decision === "edited").length,
            rejected: l.filter((r) => r.decision === "rejected").length,
            generated: g.length,
            automatic: g.filter((r) => r.decision === "automatic").length,
          };
          const decided = d.filter((r) => r.decision_status === "delivered" || r.correction || r.status === "resolved");
          const replies = {
            reviewed: decided.length,
            approvedAsIs: decided.filter((r) => r.decision_status === "delivered" && !r.correction).length,
            edited: decided.filter((r) => !!r.correction).length,
            rejected: decided.filter((r) => r.decision_status !== "delivered" && !r.correction).length,
            drafts: d.length,
            handedOver: d.filter((r) => r.type === "escalation").length,
          };
          const checked = inWeek(checks, w).filter((c) => Number(c.total) > 0);
          return {
            week: w,
            plans,
            replies,
            approvedWithoutEdits: share(plans.approvedAsIs + replies.approvedAsIs, plans.reviewed + replies.reviewed),
            handOffRate: {
              plans: share(plans.generated - plans.automatic, plans.generated),
              replies: share(replies.handedOver, replies.drafts),
            },
            medianEditSize: {
              /** Plan fields the coach changed per edited plan. */
              planChanges: median(l.filter((r) => r.decision === "edited").map((r) => Number(r.changes) || 0)),
              /** Share of words the coach changed in an edited reply. */
              replyWordsChanged: median(
                d
                  .filter((r) => r.correction)
                  .map((r) => wordChange(r.correction.rejected?.message ?? "", r.correction.preferred?.message ?? "")),
              ),
            },
            heldOutPassRate: share(
              checked.reduce((n, c) => n + Number(c.passed), 0),
              checked.reduce((n, c) => n + Number(c.total), 0),
            ),
          };
        }),
        checks: checks
          .filter((c) => Number(c.total) > 0)
          .slice(0, 24)
          .map((c) => ({
            area: area[c.kind],
            id: c.id,
            status: c.status,
            createdAt: c.created_at,
            version: c.version ?? null,
            passed: Number(c.passed),
            total: Number(c.total),
            passRate: share(Number(c.passed), Number(c.total)),
          })),
        learning: {
          liveSnapshot: snapshot
            ? { id: snapshot.id, examples: (snapshot.data.rows ?? []).length, since: snapshot.updated_at }
            : null,
          waiting,
        },
        visibility: "coach_only",
      };
    });
  });

  // What the Brain remembers about one member (built by code from their own
  // logs; nothing when their coaching consent is withdrawn).
  app.get("/api/v1/brain/members/:id/memory", async (req) => {
    const a = trainer(req);
    const memberId = z.string().uuid().parse((req.params as any).id);
    return db.tenant(a, async (tx) => {
      const [member] = await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
        [a.tenantId, memberId],
      );
      if (!member) throw fail(404, "NOT_FOUND", "This member is unavailable");
      return { memory: await loadMemberMemory(tx, memberId) };
    });
  });
}
