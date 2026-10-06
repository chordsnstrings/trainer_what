import type { Tx } from "@trainer/db";
import { audioReadiness } from "./service-readiness.ts";

/** Member-owned facts only. No private Brain drafts or coach review details. */
export async function memberSetup(
  tx: Tx,
  userId: string,
  access: { active: boolean; modules: string[]; premiumVoice: boolean },
  guidedHref: string,
) {
  const rows = await tx.query(
    "SELECT kind,status,data FROM records WHERE owner_user_id=$1 AND kind IN ('intake','nutrition_profile','program','nutrition_plan') ORDER BY created_at DESC,id DESC LIMIT 200",
    [userId],
  );
  const permissions = await tx.query(
    "SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('coaching','nutrition','nutrition_model','voice_playback') ORDER BY document_type,created_at DESC,id DESC",
    [userId],
  );
  const allowed = (key: string) =>
    permissions.some((p) => p.document_type === key && p.granted);
  const has = (kind: string, status?: string) =>
    rows.some((r) => r.kind === kind && (!status || r.status === status));
  const steps = [
    {
      key: "membership",
      done: access.active,
      owner: "member",
      href: "/app/membership",
    },
    {
      key: "training_profile",
      done: has("intake") && allowed("coaching"),
      owner: "member",
      href: "/app/intake",
    },
    {
      key: "training_plan",
      done: has("program", "assigned"),
      owner: "coach",
      href: "/app/chat",
    },
  ];
  if (access.modules.includes("nutrition"))
    steps.push(
      {
        key: "food_profile",
        done:
          has("nutrition_profile") &&
          allowed("nutrition") &&
          allowed("nutrition_model"),
        owner: "member",
        href: "/app/nutrition",
      },
      {
        key: "food_plan",
        done: has("nutrition_plan", "delivered"),
        owner: "member",
        href: "/app/nutrition",
      },
    );
  if (access.premiumVoice) {
    const audio = await audioReadiness(tx);
    steps.push({
      key: "guided_audio",
      done: audio.ready && allowed("voice_playback"),
      owner: audio.ready ? "member" : "coach",
      href: audio.ready ? guidedHref : "/app/chat",
    });
  }
  return steps;
}
