import { putRecord, type Actor, type Database } from "@trainer/db";
export const previewIntake = { age: 32, goal: "Build strength and muscle", experience: "beginner", daysPerWeek: 3, availableWeekdays: [1, 3, 5], maxSessionMinutes: 60, equipment: "Dumbbells, bench", limitations: "None reported", consent: true };
/** Isolated tests only: actual provider-facing plan generation uses this library. */
export async function seedPreviewBrain(db: Database, a: Actor) {
  return db.tenant(a, async tx => {
    const rule = await putRecord(tx, a, "rule", { title: "Beginner strength progression", category: "progression", condition: "Programme design and strength training", directive: "Progress load in small steps for beginner strength clients training three days a week with dumbbells. Deload every fourth week. Ask about availability before changing training.", reason: "Synthetic trainer method", sourceIds: [], allowedUses: ["model_prompt", "render"] }, { status: "confirmed" });
    await tx.query("UPDATE records SET status='archived' WHERE kind='brain_release' AND status='published'");
    const release = await putRecord(tx, a, "brain_release", { rules: [{ id: rule.id, version: rule.version, data: rule.data }], mode: "supervised", synthetic: true }, { status: "published" });
    for (const [name, equipment] of [["Goblet squat", ["dumbbells"]], ["Dumbbell bench press", ["dumbbells", "bench"]], ["One-arm dumbbell row", ["dumbbells", "bench"]], ["Romanian deadlift", ["dumbbells"]], ["Plank", ["bodyweight"]], ["Bodyweight squat", ["bodyweight"]], ["Push-up", ["bodyweight"]]] as const)
      await putRecord(tx, a, "exercise", { name, equipment, sets: 3, reps: 10, loadKg: 0, restSeconds: 90, rir: 2, cue: "Move with control", alternatives: [] }, { status: "active" });
    return release;
  });
}
