import type { Actor, Database } from "@trainer/db";
import { deliverReviewedCoachingDecision } from "./coaching-completion.ts";
import { loadConversationContext } from "./conversation-context.ts";
import { reviewPlanGeneration } from "./brain-plans.ts";

/** The DB independently checks that this owner owns this active private test member. */
export async function autoReviewPreviewReply(db: Database, a: Actor, decisionId: string) {
  if (!a.previewMemberId || a.role !== "owner") throw new Error("Private preview review scope required");
  return db.tenant(a, async tx => {
    const [row] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='decision' AND owner_user_id=$2 FOR UPDATE", [decisionId, a.previewMemberId]);
    if (!row) return null;
    if (row.status === "approved" && row.data.privatePreviewApproval) {
      const [message] = await tx.query("SELECT id,data FROM records WHERE kind='message' AND owner_user_id=$1 AND data->>'decisionId'=$2 AND status='sent' ORDER BY created_at DESC,id DESC LIMIT 1", [a.previewMemberId, decisionId]);
      return message ? { decisionId, messageId: message.id, message: message.data.text, pendingReview: false, privatePreviewApproval: true } : null;
    }
    if (row.status !== "pending_review") return null;
    // A private test removes the routine human approval click, not personal-review
    // boundaries or prescription validation. Legacy model programs are only drafts.
    if (row.data.type === "escalation" || row.data.program || (!row.data.actionId && row.data.type !== "message")) return null;
    const [personal] = await tx.query("SELECT id FROM records WHERE owner_user_id=$1 AND ((kind='takeover' AND status='active') OR (kind='exception' AND status='open' AND data->>'decisionId'=$2 AND data->>'category' IN ('human_review','safety'))) LIMIT 1", [a.previewMemberId, decisionId]);
    if (personal) return null;
    if (row.data.conversationDigest && (await loadConversationContext(tx, a.previewMemberId!, row.data.requestMessageId)).digest !== row.data.conversationDigest)
      return null;
    const result = await deliverReviewedCoachingDecision(tx, a, row);
    await tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [row.id, JSON.stringify({ privatePreviewApproval: true })]);
    await tx.query("UPDATE records SET status='resolved',version=version+1,updated_at=now() WHERE kind='exception' AND owner_user_id=$1 AND data->>'decisionId'=$2 AND data->>'category'='decision_review' AND status='open'", [a.previewMemberId, decisionId]);
    return { ...result, pendingReview: false, privatePreviewApproval: true };
  });
}

export async function autoReviewPreviewPlan(db: Database, a: Actor, result: any) {
  if (!a.previewMemberId || a.role !== "owner") throw new Error("Private preview review scope required");
  if (!result?.generationId || result.status !== "pending_review") return result;
  const [row] = await db.tenant(a, tx => tx.query("SELECT * FROM records WHERE id=$1 AND kind='plan_generation' AND owner_user_id=$2", [result.generationId, a.previewMemberId]));
  if (!row) return result;
  if (row.status === "delivered") return { status: "delivered", generationId: row.id, programId: row.data.outcome?.programId };
  if (row.status !== "pending_review" || !row.data.draft || row.data.validation?.errors?.length) return result;
  // Use the real delivery validator: stale profile, health holds, invalid prescriptions and
  // missing consent still block. recordLearning already excludes private preview reviewers.
  try {
    return await reviewPlanGeneration(db, a, row.id, { action: "approve", version: row.version, note: "Automatically approved for the trainer's private subscriber preview only; not customer qualification or teaching." });
  } catch (error) {
    if (![400, 409].includes(Number((error as any).statusCode))) throw error;
    return { ...result, previewBlocked: true, message: (error as Error).message };
  }
}
