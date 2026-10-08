import { createHash } from "node:crypto";
import type { Tx } from "@trainer/db";
import { communicationFromStyle, trainerBrainContext, trainerCommunicationSchema, type TrainerCommunication } from "../../../packages/domain/src/trainer-brain.ts";

/** Working material is read only by coaching-team evaluation/publication paths. */
export async function candidateCommunication(tx: Tx): Promise<TrainerCommunication> {
  const [row] = await tx.query("SELECT style FROM voice_session_styles");
  return communicationFromStyle(row?.style);
}

export const communicationDigest = (communication: unknown) => createHash("sha256")
  .update(JSON.stringify(trainerCommunicationSchema.parse(communication ?? {}))).digest("hex");

/** Legacy checks describe no communication profile, never a newly supplied one. */
export function checkedCommunication(evaluation: any, communication: unknown) {
  return (evaluation?.data?.communicationDigest ?? communicationDigest({})) === communicationDigest(communication);
}

/** The member scope gets only the published release, never working style answers. */
export async function publishedTrainerBrain(tx: Tx) {
  const [release] = await tx.query("SELECT * FROM member_material('brain_release')");
  return trainerBrainContext(release);
}
