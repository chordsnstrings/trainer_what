import type { Tx } from "@trainer/db";
import { voiceContract } from "../../../packages/providers/src/integrations.ts";
import { planModelConfigured } from "../../../packages/providers/src/brain-plans.ts";

export async function trainingReadiness(tx: Tx) {
  const [row] = await tx.query("SELECT member_training_readiness() AS value");
  const state = row?.value ?? {};
  const issues: string[] = [];
  if (!state.brain) issues.push("Publish your coaching Brain.");
  if (!(state.exercises > 0))
    issues.push("Add exercises or a programme template to your library.");
  if (!planModelConfigured())
    issues.push("The platform must connect the coaching model.");
  return { ready: !issues.length, issues, mode: state.mode ?? "supervised" };
}

export async function audioReadiness(tx: Tx) {
  const issues: string[] = [];
  let contract: ReturnType<typeof voiceContract> | null = null;
  try {
    contract = voiceContract();
  } catch {
    issues.push("The platform must enable the voice provider.");
  }
  const [voice] = await tx.query(
    "SELECT provider,provider_voice_id,consented FROM guided_voice()",
  );
  if (!voice?.consented || !voice?.provider_voice_id)
    issues.push("Verify your coaching voice and its permission.");
  else if (contract && voice.provider !== contract.provider)
    issues.push("Reconnect your voice to the active provider.");
  return { ready: !issues.length, issues };
}

export async function requireServiceReady(
  tx: Tx,
  offer: { premiumVoice?: boolean; modules?: string[] },
  audioOnly = false,
) {
  const training = audioOnly ? null : await trainingReadiness(tx);
  const audio =
    audioOnly || offer.premiumVoice || offer.modules?.includes("voice")
      ? await audioReadiness(tx)
      : null;
  const issues = [...(training?.issues ?? []), ...(audio?.issues ?? [])];
  if (issues.length)
    throw Object.assign(new Error(issues.join(" ")), {
      statusCode: 409,
      code: "SERVICE_NOT_READY",
    });
}
