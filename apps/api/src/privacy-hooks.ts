import type { Tx } from "@trainer/db";
import type { PrivacyHooks } from "./privacy-lifecycle.ts";
import { exportChatAttachments, eraseChatAttachments, closeChatAttachments } from "./chat-attachments.ts";
async function exists(tx: Tx, table: string) {
  return !!(
    await tx.query("SELECT to_regclass($1) name", ["public." + table])
  )[0].name;
}
async function rows(
  tx: Tx,
  table: string,
  fields: string,
  where: string,
  values: any[],
) {
  return (await exists(tx, table))
    ? tx.query(`SELECT ${fields} FROM ${table} WHERE ${where}`, values)
    : [];
}
async function remove(
  tx: Tx,
  table: string,
  where = "true",
  values: any[] = [],
) {
  if (await exists(tx, table))
    await tx.query(`DELETE FROM ${table} WHERE ${where}`, values);
}
export async function withdrawIntegrations(
  tx: Tx,
  userId: string,
  kind: "voice" | "wearable",
) {
  if (kind === "wearable" && (await exists(tx, "integration_connections"))) {
    await tx.query(
      "UPDATE integration_connections SET status=CASE WHEN credentials IS NULL THEN 'revoked' ELSE 'revocation_pending' END,version=version+1,lease_until=NULL,next_sync_at=now(),summary='{\"message\":\"Permission withdrawn; provider revocation pending.\"}' WHERE user_id=$1",
      [userId],
    );
    await tx.query(
      "UPDATE integration_oauth_states SET consumed_at=now(),verifier='' WHERE user_id=$1 AND consumed_at IS NULL",
      [userId],
    );
  }
  if (kind === "voice" && (await exists(tx, "trainer_voices"))) {
    await tx.query(
      "UPDATE guided_audio SET status='revoked',audio=NULL WHERE user_id=$1 OR voice_id IN (SELECT id FROM trainer_voices WHERE user_id=$1)",
      [userId],
    );
    await tx.query(
      "UPDATE trainer_voices SET status='revoked',sample=NULL,provider_voice_id=NULL,version=version+1 WHERE user_id=$1",
      [userId],
    );
  }
}
export const privacyHooks: PrivacyHooks = {
  async providerInventory(tx, userId) {
    const providerRows = await tx.query(
      "SELECT DISTINCT provider FROM cost_events WHERE ($1::uuid IS NULL OR user_id=$1)",
      [userId ?? null],
    );
    const connections = await rows(
      tx,
      "integration_connections",
      "provider",
      "($1::uuid IS NULL OR user_id=$1) AND status<>'revoked'",
      [userId ?? null],
    );
    const voices = await rows(
      tx,
      "trainer_voices",
      "id",
      "($1::uuid IS NULL OR user_id=$1) AND status<>'revoked'",
      [userId ?? null],
    );
    const domains = userId
      ? []
      : await rows(
          tx,
          "domain_orders",
          "id",
          "status NOT IN ('cancelled','expired')",
          [],
        );
    return [
      ...new Set(
        [...providerRows, ...connections].map((r) => String(r.provider)),
      ),
    ].concat(
      voices.length ? ["Voice provider"] : [],
      domains.length ? ["Domain registrar"] : [],
    );
  },
  async exportAdditional(tx, userId) {
    return {
      chatAttachments: await exportChatAttachments(tx, userId),
      connections: await rows(
        tx,
        "integration_connections",
        "id,provider,status,scopes,summary,last_synced_at,created_at",
        "user_id=$1",
        [userId],
      ),
      voice: await rows(
        tx,
        "trainer_voices",
        "id,status,consent_version,evidence,sample_type,created_at",
        "user_id=$1",
        [userId],
      ),
      guidedAudio: await rows(
        tx,
        "guided_audio",
        "id,workout_id,status,text_content,data,created_at",
        "user_id=$1",
        [userId],
      ),
      notificationPreferences: await rows(
        tx,
        "notification_preferences",
        "*",
        "user_id=$1",
        [userId],
      ),
      notifications: await rows(tx, "notifications", "*", "user_id=$1", [
        userId,
      ]),
      uploadedMedia: await rows(
        tx,
        "brand_media",
        "id,filename,width,height,created_at",
        "owner_user_id=$1",
        [userId],
      ),
      galleries: await rows(
        tx,
        "coach_galleries",
        "id,title,description,audience,created_at",
        "owner_user_id=$1",
        [userId],
      ),
    };
  },
  async eraseAdditional(tx, userId) {
    await eraseChatAttachments(tx, userId);
    // Remove guided audio before workout records because the audio has an FK to
    // its workout. Provider revocation/purge remains an explicit evidence task.
    if (await exists(tx, "trainer_voices")) {
      await tx.query(
        "DELETE FROM guided_audio WHERE user_id=$1 OR voice_id IN (SELECT id FROM trainer_voices WHERE user_id=$1)",
        [userId],
      );
      await tx.query("DELETE FROM trainer_voices WHERE user_id=$1", [userId]);
    }
    if (await exists(tx, "integration_connections"))
      await tx.query(
        "UPDATE integration_connections SET status=CASE WHEN credentials IS NULL THEN 'revoked' ELSE 'revocation_pending' END,version=version+1,external_user_id=NULL,scopes='{}',summary='{\"message\":\"Local account erased; credentials retained only for pending provider revocation.\"}',lease_until=NULL,next_sync_at=now() WHERE user_id=$1",
        [userId],
      );
    for (const table of [
      "integration_oauth_states",
      "notifications",
      "notification_preferences",
    ])
      await remove(tx, table, "user_id=$1", [userId]);
  },
  async closeAdditional(tx) {
    await closeChatAttachments(tx);
    for (const table of [
      "guided_audio",
      "integration_oauth_states",
      "trainer_voices",
      "notifications",
      "notification_preferences",
      "coach_gallery_photos",
      "coach_galleries",
      "coach_sites",
      "coach_design_drafts",
      "brand_media",
    ])
      await remove(tx, table);
    if (await exists(tx, "domain_orders"))
      await tx.query(
        "UPDATE domain_orders SET token='',version=version+1 WHERE token<>''",
      );
  },
};
