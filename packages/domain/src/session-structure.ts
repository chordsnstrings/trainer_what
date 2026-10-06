import { z } from "zod";

/** Optional on legacy prescriptions. IDs identify repeated movements. */
export const structureShape = {
  instanceId: z.string().uuid().optional(),
  block: z.enum(["warmup", "main", "cooldown"]).optional(),
  side: z.enum(["both", "left", "right"]).optional(),
  group: z
    .object({
      id: z.string().trim().min(1).max(40),
      kind: z.enum(["superset", "circuit"]),
    })
    .strict()
    .optional(),
};
export type StructuredExercise = {
  name: string;
  sets: number;
  instanceId?: string;
  block?: "warmup" | "main" | "cooldown";
  side?: "both" | "left" | "right";
  group?: { id: string; kind: "superset" | "circuit" };
};
export function structureIssues(items: StructuredExercise[]): string[] {
  const issues: string[] = [],
    seen = new Set<string>(),
    groups = new Set<string>();
  let phase = 0;
  for (let i = 0; i < items.length; i++) {
    const e = items[i],
      rank = ["warmup", "main", "cooldown"].indexOf(e.block ?? "main");
    if (rank < phase)
      issues.push("Keep warm-up, main work and cool-down in order");
    phase = rank;
    if (e.instanceId && seen.has(e.instanceId))
      issues.push("Exercise instances must have unique IDs");
    if (e.instanceId) seen.add(e.instanceId);
    const repeats = items.filter(
      (x) => x.name.toLowerCase() === e.name.toLowerCase(),
    );
    if (repeats.length > 1 && repeats.some((x) => !x.instanceId))
      issues.push("Repeated exercises need distinct instance IDs");
    if (e.group && items[i - 1]?.group?.id !== e.group.id) {
      if (groups.has(e.group.id))
        issues.push("Keep each superset or circuit together");
      groups.add(e.group.id);
      const members = items.filter((x) => x.group?.id === e.group!.id);
      if (
        members.length < 2 ||
        (e.group.kind === "superset" && members.length !== 2)
      )
        issues.push(
          "A superset needs two exercises; a circuit needs at least two",
        );
      if (
        members.some(
          (x) =>
            x.sets !== e.sets ||
            x.group?.kind !== e.group?.kind ||
            (x.block ?? "main") !== (e.block ?? "main"),
        )
      )
        issues.push(
          "Grouped exercises must share their rounds, kind and block",
        );
    }
  }
  return [...new Set(issues)];
}
/** A stable execution order: grouped exercises alternate each round. */
export function sessionOrder(
  items: StructuredExercise[],
): Array<{ exercise: number; set: number }> {
  const order: Array<{ exercise: number; set: number }> = [];
  for (let i = 0; i < items.length;) {
    const e = items[i];
    let end = i + 1;
    if (e.group)
      while (end < items.length && items[end].group?.id === e.group.id) end++;
    for (let set = 1; set <= e.sets; set++)
      for (let exercise = i; exercise < end; exercise++)
        order.push({ exercise, set });
    i = end;
  }
  return order;
}
