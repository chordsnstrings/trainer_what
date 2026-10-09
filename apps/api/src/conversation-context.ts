import { createHash } from "node:crypto";
import type { Tx } from "@trainer/db";
import { conversationAuthors, conversationContextPolicy, selectConversationTurns, type ConversationContext } from "../../../packages/domain/src/conversation-context.ts";

/** Read in the caller's tenant/member scope; never persist a second transcript. */
export async function loadConversationContext(tx: Tx, userId: string, excludeMessageId: string) {
  const [consent] = await tx.query(
    "SELECT id,granted,created_at FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1", [userId],
  );
  const [intake] = await tx.query(
    "SELECT id,version,data FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [userId],
  );
  const permitted = !!consent?.granted && intake?.data?.allowedUses?.includes("model_prompt");
  const rows = permitted ? await tx.query(
    `SELECT id,version,data->>'author' AS author,data->>'text' AS text,created_at
     FROM records WHERE kind='message' AND status='sent' AND owner_user_id=$1 AND id<>$2
     AND data->>'author'=ANY($3::text[]) AND length(trim(coalesce(data->>'text','')))>0
     AND created_at>=now()-interval '${conversationContextPolicy.windowDays} days' AND created_at>=$4
     ORDER BY created_at DESC,id DESC LIMIT $5`,
    [userId, excludeMessageId, [...conversationAuthors], consent.created_at, conversationContextPolicy.maxTurns],
  ) : [];
  // Project explicitly: attachment data, internal review notes and private decisions never enter the prompt.
  const selected = selectConversationTurns(rows.map(row => ({
    id: row.id, version: row.version, author: row.author, text: row.text,
    sentAt: new Date(row.created_at).toISOString(),
  })));
  const context: ConversationContext | null = permitted ? {
    version: conversationContextPolicy.version,
    turns: selected.map(({ author, text, sentAt }) => ({ author: author as ConversationContext["turns"][number]["author"], text, sentAt })),
  } : null;
  const source = selected.map(({ id, version }) => ({ id, version }));
  const digest = createHash("sha256").update(JSON.stringify({
    context, source, consentId: consent?.id ?? null, permitted: !!permitted,
    intake: intake ? { id: intake.id, version: intake.version } : null,
  })).digest("hex");
  return { context, digest, messageIds: source.map(row => row.id) };
}
