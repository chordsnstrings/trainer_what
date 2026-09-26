import { z } from "zod";

export const trainingExerciseSchema = z.object({
  name: z.string().trim().min(2).max(100),
  sets: z.number().int().min(1).max(10), reps: z.number().int().min(1).max(100),
  restSeconds: z.number().int().min(0).max(600), loadKg: z.number().min(0).max(500).default(0),
  rir: z.number().min(0).max(10).default(2), cue: z.string().max(1000).default(""),
  demonstrationUrl: z.url().refine((v) => new URL(v).protocol === "https:", "Use an HTTPS demonstration link").optional(),
  alternatives: z.array(z.object({ name: z.string().trim().min(2).max(100), cue: z.string().max(1000).default(""), loadKg: z.number().min(0).max(500).default(0) }).strict()).max(10).default([]),
}).strict();
export const trainingProgramSchema = z.object({
  title: z.string().trim().min(2).max(120), goal: z.string().max(1000), daysPerWeek: z.number().int().min(1).max(7),
  exercises: z.array(trainingExerciseSchema).min(1).max(20),
  weeks: z.number().int().min(1).max(26).default(4),
  sessions: z.array(z.object({ label: z.string().trim().min(2).max(120), weekday: z.number().int().min(0).max(6), exercises: z.array(trainingExerciseSchema).min(1).max(20) }).strict()).min(1).max(7).optional(),
}).strict().superRefine((value, ctx) => {
  for (const exercises of [value.exercises, ...(value.sessions ?? []).map((s) => s.exercises)]) {
    if (new Set(exercises.map((e) => e.name.toLowerCase())).size !== exercises.length) ctx.addIssue({ code: "custom", path: ["exercises"], message: "Each exercise name must be unique within a session" });
  }
  if (value.sessions && value.sessions.length !== value.daysPerWeek) ctx.addIssue({ code: "custom", path: ["sessions"], message: "Sessions must match the number of days per week" });
  if (value.sessions && new Set(value.sessions.map((s) => s.weekday)).size !== value.sessions.length) ctx.addIssue({ code: "custom", path: ["sessions"], message: "Choose one training session per weekday" });
});
export const trainingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => Number.isFinite(new Date(v + "T12:00:00Z").getTime()) && new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v, "Use a valid calendar date");
export function addTrainingDays(value: string, days: number) {
  const d = new Date(value + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function trainingSchedule(program: z.infer<typeof trainingProgramSchema>, startDate: string, timezone: string) {
  // Dates are calendar dates in the selected timezone; UTC noon is only used
  // for calendar arithmetic, never interpreted as a workout appointment time.
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  trainingDateSchema.parse(startDate);
  const days = program.sessions ?? Array.from({ length: program.daysPerWeek }, (_, i) => ({ label: program.title, weekday: (new Date(startDate + "T12:00:00Z").getUTCDay() + Math.floor(i * 7 / program.daysPerWeek)) % 7, exercises: program.exercises }));
  const result = [];
  for (let day = 0; day < program.weeks * 7; day++) {
    const date = addTrainingDays(startDate, day), weekday = new Date(date + "T12:00:00Z").getUTCDay();
    const session = days.find((s) => s.weekday === weekday);
    if (session) result.push({ date, timezone, week: Math.floor(day / 7) + 1, label: session.label, program: { ...program, title: session.label, exercises: session.exercises } });
  }
  return result;
}
export function effectiveWorkoutSets(sets: any[], corrections: any[]) {
  const latest = new Map<string, any>();
  for (const c of [...corrections].sort((a, b) => Number(a.data.revision) - Number(b.data.revision))) latest.set(c.data.eventId, c);
  return sets.map((set) => latest.has(set.id) ? { ...set, data: { ...set.data, ...latest.get(set.id).data.values }, correctionId: latest.get(set.id).id } : set);
}

export const coachingActions = ["message", "program_build", "progression", "substitution", "schedule"] as const;
export const coachActionSchema = z.object({
  title: z.string().trim().min(3).max(150), type: z.enum(coachingActions),
  requestTerms: z.array(z.string().trim().min(3).max(120)).min(1).max(12),
  response: z.string().trim().min(10).max(4000), rationale: z.string().trim().min(10).max(2000),
  evidenceIds: z.array(z.string().uuid()).min(1).max(20),
  experience: z.array(z.enum(["beginner", "intermediate", "advanced"])).min(1).max(3),
  requiredEquipment: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
  exercise: z.string().trim().min(2).max(100).optional(), replacement: trainingExerciseSchema.optional(),
  templateId: z.string().uuid().optional(),
  increaseKg: z.number().positive().max(10).optional(), maxIncreasePercent: z.number().positive().max(10).optional(),
  minimumRir: z.number().min(1).max(10).default(2), minimumCompletedSets: z.number().int().min(2).max(12).default(3),
  daysOffset: z.number().int().min(1).max(3).optional(),
}).strict().superRefine((a, ctx) => {
  if (a.type === "progression" && (!a.exercise || !a.increaseKg || !a.maxIncreasePercent)) ctx.addIssue({ code: "custom", message: "Progression needs an exercise, load increment and percentage bound" });
  if (a.type === "substitution" && (!a.exercise || !a.replacement)) ctx.addIssue({ code: "custom", message: "Substitution needs an exercise and an approved replacement" });
  if (a.type === "program_build" && !a.templateId) ctx.addIssue({ code: "custom", message: "Program build needs a trainer-authored template" });
  if (a.type === "schedule" && !a.daysOffset) ctx.addIssue({ code: "custom", message: "Schedule change needs a fixed postponement of one to three days" });
});
export const teachingCaseSchema = z.object({
  scenario: z.string().trim().min(10).max(3000), category: z.enum(coachingActions),
  recommendation: z.string().trim().min(10).max(3000), reason: z.string().trim().min(10).max(3000),
  alternatives: z.string().max(2000), changeWhen: z.string().trim().min(10).max(2000), escalateWhen: z.string().trim().min(10).max(2000),
}).strict();
export const coachingPromptVersion = "coach-action-selector-v1";
export const coachingFactsSchema = z.object({
  profile: z.object({ experience: z.enum(["beginner", "intermediate", "advanced"]), daysPerWeek: z.number().int().min(1).max(7), equipment: z.string().max(1000), limitations: z.string().max(2000) }).strict(),
  program: z.object({ id: z.string().uuid(), version: z.number().int().positive(), title: z.string().max(120), daysPerWeek: z.number().int().min(1).max(7), exercises: z.array(trainingExerciseSchema).max(20) }).strict().nullable().default(null),
  sets: z.array(z.object({ id: z.string().uuid(), exercise: z.string().max(100), reps: z.number().int().min(0).max(200), loadKg: z.number().min(0).max(500), rir: z.number().min(0).max(10).optional(), completed: z.boolean() }).strict()).max(50).default([]),
  nextSession: z.object({ id: z.string().uuid(), version: z.number().int().positive(), date: trainingDateSchema }).strict().nullable().default(null),
  occupiedDates: z.array(trainingDateSchema).max(200).default([]),
  currentDate: trainingDateSchema, activeWorkout: z.boolean().default(false),
}).strict();
export type CoachingFacts = z.infer<typeof coachingFactsSchema>;
export function eligibleCoachAction(action: z.infer<typeof coachActionSchema>, request: string, facts: CoachingFacts, template?: any) {
  const normal = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!action.requestTerms.some((term) => (" " + normal(request) + " ").includes(" " + normal(term) + " "))) return false;
  if (!action.experience.includes(facts.profile.experience)) return false;
  if (!["none", "none reported", "no limitations", "no known limitations"].includes(normal(facts.profile.limitations))) return false;
  const equipment = facts.profile.equipment.split(/[,;\n]/).map(normal);
  if (action.requiredEquipment.some((e) => !equipment.includes(normal(e)))) return false;
  if (action.type === "message") return true;
  if (facts.activeWorkout) return false;
  if (action.type === "program_build") return !!template && template.status === "template" && template.data.daysPerWeek <= facts.profile.daysPerWeek;
  if (action.type === "schedule") {
    if (!facts.nextSession || facts.nextSession.date < facts.currentDate) return false;
    const date = addTrainingDays(facts.nextSession.date, action.daysOffset!);
    if (facts.occupiedDates.includes(date)) return false;
    const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7, weekStart = addTrainingDays(date, -weekday), weekEnd = addTrainingDays(weekStart, 6);
    return facts.occupiedDates.filter((d) => d !== facts.nextSession!.date && d >= weekStart && d <= weekEnd).length + 1 <= facts.profile.daysPerWeek;
  }
  const exercise = facts.program?.exercises.find((e) => e.name === action.exercise);
  if (!exercise) return false;
  if (action.type === "substitution") return !facts.program!.exercises.some((e) => e.name === action.replacement!.name);
  const recent = facts.sets.filter((s) => s.exercise === exercise.name && s.completed).slice(0, action.minimumCompletedSets);
  return action.type === "progression" && exercise.loadKg > 0 &&
    action.increaseKg! / exercise.loadKg * 100 <= action.maxIncreasePercent! && exercise.loadKg + action.increaseKg! <= 500 &&
    recent.length >= action.minimumCompletedSets && recent.every((s) => s.reps >= exercise.reps && s.loadKg >= exercise.loadKg && (s.rir ?? -1) >= action.minimumRir);
}
export function canonicalCoaching(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalCoaching).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => JSON.stringify(key) + ":" + canonicalCoaching(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
