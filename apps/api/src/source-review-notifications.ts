import { type Actor, type Tx } from "@trainer/db";
import { z } from "zod";
import { workspaceLock } from "./privacy-lifecycle.ts";
import { notifyUser } from "./notifications.ts";

const reference = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
});
const sourceSchema = z.discriminatedUnion("stage", [
  z.object({
    type: z.literal("brain_review"),
    version: z.literal(1),
    stage: z.literal("import"),
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("brain_review"),
    version: z.literal(1),
    stage: z.literal("compilation"),
    id: z.string().uuid(),
    sources: z.array(reference).min(1).max(20),
    rules: z.array(reference).max(12),
    conflicts: z.array(reference).max(12),
    expiresAt: z.iso.datetime(),
  }),
]);
type Reference = z.infer<typeof reference>;
const expiresAt = () => new Date(Date.now() + 48 * 3600000).toISOString();

export async function lockBrainReviewActor(tx: Tx, a: Actor) {
  await workspaceLock(tx, a.tenantId);
  const [current] = await tx.query(
    "SELECT training_actor_is_current($1,$2,$3) AS current",
    [a.tenantId, a.userId, a.role],
  );
  if (!["owner", "staff"].includes(a.role) || !current?.current)
    throw Object.assign(new Error("Current trainer access is required"), {
      statusCode: 403,
      code: "WORKSPACE_CHANGED",
    });
}

export async function notifyImportReview(tx: Tx, a: Actor, record: any) {
  await lockBrainReviewActor(tx, a);
  const source = sourceSchema.parse({
    type: "brain_review",
    version: 1,
    stage: "import",
    id: record.id,
    revision: record.version,
    expiresAt: expiresAt(),
  });
  return notifyUser(tx, a, {
    userId: a.userId,
    category: "coaching",
    dedupeKey: `brain-review:import:${record.id}:${record.version}`,
    title: "Your uploaded material is ready for review",
    body: "Extraction is complete. Review the material and remove identifying details before approving it for your coaching knowledge.",
    href: "/trainer/brain/knowledge",
    templateKey: "brain-import-review-v1",
    source,
  });
}

export async function notifyCompilationReview(
  tx: Tx,
  a: Actor,
  batch: {
    id: string;
    sources: Reference[];
    rules: Reference[];
    conflicts: Reference[];
  },
) {
  if (!batch.rules.length && !batch.conflicts.length) return null;
  await lockBrainReviewActor(tx, a);
  const source = sourceSchema.parse({
    ...batch,
    type: "brain_review",
    version: 1,
    stage: "compilation",
    expiresAt: expiresAt(),
  });
  return notifyUser(tx, a, {
    userId: a.userId,
    category: "coaching",
    dedupeKey: `brain-review:compilation:${batch.id}`,
    title: "Your draft coaching rules are ready",
    body: `Compilation produced ${batch.rules.length} draft rule${batch.rules.length === 1 ? "" : "s"} and ${batch.conflicts.length} potential conflict${batch.conflicts.length === 1 ? "" : "s"}. Review the proposals and resolve conflicts before publishing.`,
    href: batch.conflicts.length
      ? "/trainer/brain/knowledge"
      : "/trainer/brain/constitution",
    templateKey: "brain-compilation-review-v1",
    source,
  });
}

/** Generic notices contain no uploaded text, file names, client facts or rule text. */
export async function brainReviewNotificationCurrent(
  tx: Tx,
  tenantId: string,
  userId: string,
  value: unknown,
  now = new Date(),
) {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= now.getTime())
    return false;
  const source = parsed.data;
  await workspaceLock(tx, tenantId);
  const [member] = await tx.query(
    "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
    [tenantId, userId],
  );
  if (!member || !["owner", "staff"].includes(member.role)) return false;
  const [current] = await tx.query(
    "SELECT training_actor_is_current($1,$2,$3) AS current",
    [tenantId, userId, member.role],
  );
  if (!current?.current) return false;
  if (source.stage === "import") {
    const [record] = await tx.query(
      "SELECT id FROM records WHERE id=$1 AND kind='source_import' AND owner_user_id=$2 AND status='needs_review' AND version=$3",
      [source.id, userId, source.revision],
    );
    return !!record;
  }
  if (member.role !== "owner") return false;
  const [batch] = await tx.query(
    "SELECT data FROM events WHERE name='brain.compiled' AND subject_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 1",
    [source.id, userId],
  );
  if (
    !batch ||
    batch.data.rules !== source.rules.length ||
    batch.data.conflicts !== source.conflicts.length
  )
    return false;
  const expected = [...source.sources, ...source.rules, ...source.conflicts];
  if (new Set(expected.map((r) => r.id)).size !== expected.length) return false;
  const rows = await tx.query(
    "SELECT id,kind,status,version,data FROM records WHERE id=ANY($1::uuid[])",
    [expected.map((r) => r.id)],
  );
  if (rows.length !== expected.length) return false;
  const matches = (refs: Reference[], valid: (r: any) => boolean) =>
    refs.every((ref) =>
      rows.some(
        (r) => r.id === ref.id && r.version === ref.version && valid(r),
      ),
    );
  return (
    matches(
      source.sources,
      (r) =>
        ((r.kind === "source" && r.status === "ready") ||
          (r.kind === "interview" && r.status === "answered")) &&
        r.data.allowedUses?.includes("model_prompt") &&
        r.data.allowedUses?.includes("trainer_specific_learning"),
    ) &&
    matches(source.rules, (r) => r.kind === "rule" && r.status === "draft") &&
    matches(
      source.conflicts,
      (r) => r.kind === "conflict" && r.status === "open",
    )
  );
}
