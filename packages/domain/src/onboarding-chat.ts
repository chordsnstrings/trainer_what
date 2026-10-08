import { z } from "zod";
import { groundSetupDraft, mentionsModelVendor, setupFields, type Specialty } from "./setup-assistant.ts";
import { givesMedicalAdvice } from "./text-screen.ts";
import { coachingUpdateSchema, nextCoachingQuestion, coachingCoverage, type CoachingInterview } from "./coaching-interview.ts";

export const CHAT_VERSION = "onboarding-chat-v4";
export type ChatAudience = "coach" | "member";
export type ChatMode = "setup" | "teach";
export type OnboardingAttachment = { id: string; name: string; bytes: number; format: string; characters: number; warnings: string[]; image: boolean; preview?: string };
export type ChatMessage = { id: string; from: "person" | "assistant"; text: string; at: string; attachments?: OnboardingAttachment[]; source?: "voice" };
export type ChatMemory = Record<string, { evidence: string; messageId: string; at: string }>;
export type ChatData = {
  audience: ChatAudience; mode: ChatMode; messages: ChatMessage[];
  facts: Record<string, any>; memory: ChatMemory; skipped: string[];
  teachingIds: string[]; compiledIds: string[]; paused: boolean;
  applied: Record<string, string>; pending?: { id: string; at: string }; lastQuestion?: { field: string; text: string };
  error?: string; archived?: number;
  interview?: CoachingInterview;
};
export const replySchema = z.object({
  reply: z.string().trim().min(1).max(700),
  patch: z.record(z.string(), z.unknown()).default({}),
  evidence: z.record(z.string(), z.string().max(1000)).default({}),
  question: z.string().max(220).optional(),
  questionField: z.string().max(50).optional(),
  coaching: coachingUpdateSchema.optional(),
}).strict();
export type ChatReply = z.infer<typeof replySchema>;
/** Normalize transport differences only; facts still require field validation and quoted evidence. */
export function parseChatReply(raw: unknown): ChatReply {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return replySchema.parse(raw);
  const value = raw as Record<string, unknown>;
  return replySchema.parse({
    reply: value.reply,
    patch: value.patch ?? {},
    evidence: value.evidence ?? {},
    question: value.question ?? undefined,
    questionField: value.questionField ?? undefined,
    coaching: value.coaching ?? undefined,
  });
}
export const memberFieldSchemas: Record<string, z.ZodType> = {
  age: z.number().int().min(18).max(100), goal: z.string().min(3).max(1000),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
  daysPerWeek: z.number().int().min(1).max(7),
  availableWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(a => new Set(a).size === a.length),
  maxSessionMinutes: z.number().int().min(15).max(180),
  equipment: z.string().min(1).max(1000), limitations: z.string().min(1).max(2000),
  diet: z.string().min(1).max(80),
  allergyStatus: z.enum(["none_reported", "reported", "unknown", "declined"]),
  allergens: z.array(z.string().min(1).max(80)).max(30),
  exclusions: z.array(z.string().min(1).max(80)).max(30),
  kitchenEquipment: z.array(z.string().min(1).max(80)).max(30),
  cookingMinutes: z.number().int().min(1).max(1440),
  foodBudget: z.enum(["low", "moderate", "flexible"]),
  nutritionScope: z.enum(["general_wellness", "specialist_needed", "unknown"]),
  nutritionNotes: z.string().max(2000),
};
export const memberQuestions: Record<string, string> = {
  goal: "What would you most like to change?",
  experience: "How much training have you done before?",
  daysPerWeek: "How many days a week can you realistically train?",
  availableWeekdays: "Which days usually work for you?",
  maxSessionMinutes: "How much time can you give each session?",
  equipment: "What equipment will you have?",
  age: "How old are you?",
  limitations: "Anything affecting how you can train, like an injury or a movement you need to avoid?",
  diet: "How do you usually like to eat?",
  allergyStatus: "Do you have any food allergies?",
  allergens: "Which foods are you allergic to?",
  exclusions: "Any other foods you avoid?",
  kitchenEquipment: "What can you cook with at home?",
  cookingMinutes: "How much time do you want to spend cooking?",
  foodBudget: "Would you describe your food budget as low, moderate or flexible?",
  nutritionScope: "Are you looking for general meal planning, or do you need help managing a medical condition?",
  nutritionNotes: "Anything else your coach should know about food?",
};
export const trainingFields = ["goal", "experience", "daysPerWeek", "availableWeekdays", "maxSessionMinutes", "equipment", "age", "limitations"];
export const nutritionFields = ["diet", "allergyStatus", "exclusions", "kitchenEquipment", "cookingMinutes", "foodBudget", "nutritionScope"];
export const coachOrder = ["audience", "publicName", "city", "specialty", "headline", "bio", "name", "priceAed", "billing"];
export function emptyChat(audience: ChatAudience, mode: ChatMode = "setup"): ChatData {
  return { audience, mode, messages: [], facts: {}, memory: {}, skipped: [], teachingIds: [], compiledIds: [], paused: false, applied: {} };
}
export function coachSpecs(specialties: readonly Specialty[]) {
  return Object.assign({}, ...(["about", "page", "brain", "plan"] as const).map(s => setupFields(s, specialties))) as ReturnType<typeof setupFields>;
}
export function hasFact(facts: Record<string, any>, key: string) {
  const value = facts[key];
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0 || ["allergens", "exclusions", "kitchenEquipment"].includes(key));
}
export function missingFacts(c: ChatData, nutrition = false) {
  const keys = c.audience === "coach" ? coachOrder : [...trainingFields, ...(nutrition ? nutritionFields : [])];
  const missing = keys.filter(k => !hasFact(c.facts, k));
  if (c.audience === "coach" && c.facts.billing === "upfront" && !hasFact(c.facts, "programmeDays")) missing.push("programmeDays");
  if (nutrition && c.facts.allergyStatus === "reported" && !c.facts.allergens?.length) missing.push("allergens");
  if (c.audience === "member" && c.facts.daysPerWeek && c.facts.availableWeekdays?.length < c.facts.daysPerWeek && !missing.includes("availableWeekdays")) missing.push("availableWeekdays");
  return missing;
}
export function nextChatQuestion(c: ChatData, specialties: readonly Specialty[], nutrition = false) {
  if (c.paused) return { field: "paused", text: "Saved. We can pick this up whenever you're ready." };
  const field = missingFacts(c, nutrition).find(f => !c.skipped.includes(f));
  if (c.audience === "coach") {
    if (field === "audience" && c.mode !== "teach") return { field, text: coachSpecs(specialties)[field]!.question };
    const coaching = nextCoachingQuestion(c);
    if (coaching) return coaching;
  }
  if (field && !(c.audience === "coach" && c.mode === "teach")) {
    return { field, text: c.audience === "member" ? memberQuestions[field] : coachSpecs(specialties)[field]?.question ?? "Tell me a little more." };
  }
  if (c.audience === "member") return { field: "review", text: missingFacts(c, nutrition).length ? "We can leave those for later. Your saved details show what we still need before your profile is ready." : "That's enough to get started. Check your profile below, or tell me what to change." };
  const coverage = coachingCoverage(c);
  return { field: "coaching.review", text: coverage.covered < coverage.total
    ? "We've left some coaching details for later. You can keep sharing, or choose Revisit deferred questions in conversation options. Your teaching is there to review too."
    : "We've explored your approach and worked through examples. You can keep adding details, or review the draft rules and try client situations in conversation options. Your Brain still needs those checks." };
}
const normal = (s: string) => s.toLowerCase().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/\s+/g, " ").trim();
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
function numberIn(value: number, evidence: string) {
  const normalized = normal(evidence).replace(/\b(one|two|three|four|five|six|seven)\b/g, w => String(numberWords[w]));
  return [...normalized.matchAll(/\d+(?:\.\d+)?/g)].some(m => Number(m[0]) === value);
}
const weekdays = [
  /\b(sun|sunday)\b|الأحد|الاحد/i, /\b(mon|monday)\b|الإثنين|الاثنين/i,
  /\b(tue|tues|tuesday)\b|الثلاثاء/i, /\b(wed|wednesday)\b|الأربعاء|الاربعاء/i,
  /\b(thu|thur|thurs|thursday)\b|الخميس/i, /\b(fri|friday)\b|الجمعة/i,
  /\b(sat|saturday)\b|السبت/i,
];
/** A model proposes facts; only fields tied to the person's current words survive. */
export function mergeChatFacts(c: ChatData, reply: ChatReply, text: string, messageId: string, at: string, specialties: readonly Specialty[], nutrition = false) {
  const next = structuredClone(c), accepted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(reply.patch)) {
    const evidence = reply.evidence[key];
    if (!evidence?.trim() || !normal(text).includes(normal(evidence))) continue;
    if (c.audience === "member" && typeof value === "number" && !numberIn(value, evidence)) continue;
    if (c.audience === "member") {
      if (!nutrition && !trainingFields.includes(key)) continue;
      const checked = memberFieldSchemas[key]?.safeParse(value);
      if (!checked?.success) continue;
      if (key === "availableWeekdays" && !(checked.data as number[]).every(day => weekdays[day]!.test(evidence) || /\b(every day|any day|all days|daily)\b|كل يوم|جميع الأيام/i.test(evidence))) continue;
      // Preserve the person's health disclosure verbatim, including negations.
      accepted[key] = ["limitations", "nutritionNotes"].includes(key) ? evidence : checked.data;
    } else accepted[key] = value;
  }
  if (c.audience === "coach") {
    const grounded: Record<string, unknown> = {};
    for (const step of ["about", "page", "brain", "plan"] as const)
      Object.assign(grounded, groundSetupDraft(step, accepted, [text], specialties, {}).fields);
    for (const key of Object.keys(accepted)) {
      if (grounded[key] === undefined) delete accepted[key];
      else accepted[key] = grounded[key];
    }
  }
  for (const [key, value] of Object.entries(accepted)) {
    next.facts[key] = value;
    next.memory[key] = { evidence: reply.evidence[key]!, messageId, at };
    next.skipped = next.skipped.filter(k => k !== key);
  }
  return next;
}
/** Short phone-message copy, no model/vendor names or unsolicited coaching advice. */
export function chatText(value: string | undefined, fallback = "Got it.") {
  if (!value || mentionsModelVendor(value) || givesMedicalAdvice(value)) return fallback;
  const text = value.replace(/^\s*#{1,6}\s*/gm, "").replace(/\*\*|__|`/g, "").replace(/^\s*[-*]\s+/gm, "").trim();
  const short = text.length > 360 ? text.slice(0, 357).trimEnd() + "…" : text;
  return short || fallback;
}
export function appendChatMessage(c: ChatData, message: ChatMessage) {
  if (!c.messages.some(m => m.id === message.id)) c.messages.push(message);
}
export function profileReady(c: ChatData) {
  const keys = c.audience === "coach" ? ["publicName", "city", "specialty", "audience", "headline", "bio"] : trainingFields;
  return keys.every(k => hasFact(c.facts, k)) && (c.audience === "coach" || c.facts.availableWeekdays.length >= c.facts.daysPerWeek);
}

/** Explicit quick replies need validation and persistence, but no inference. */
export function quickChatReply(field: string, text: string): ChatReply | null {
  const input = text.trim();
  let value: unknown;
  if (field === "daysPerWeek" && /^([1-7]) days? a week$/i.test(input)) value = Number(input[0]);
  if (["maxSessionMinutes", "cookingMinutes"].includes(field) && /^\d{1,3} minutes?$/i.test(input)) value = Number(input.match(/\d+/)![0]);
  if (field === "experience" && /^I'm (a beginner|intermediate|advanced)$/i.test(input)) value = input.toLowerCase().replace("i'm ", "").replace("a ", "");
  if (field === "equipment" && ["A full gym", "Dumbbells at home", "No equipment"].includes(input)) value = input;
  if (field === "limitations" && input === "No injuries or limitations") value = input;
  if (field === "allergyStatus") value = ({ "No food allergies": "none_reported", "I have food allergies": "reported", "I'm not sure": "unknown" } as Record<string,string>)[input];
  if (field === "exclusions" && input === "I don't avoid any foods") value = [];
  if (field === "foodBudget" && ["Low", "Moderate", "Flexible"].includes(input)) value = input.toLowerCase();
  if (field === "nutritionScope") value = ({ "General meal planning": "general_wellness", "I need help with a medical condition": "specialist_needed" } as Record<string,string>)[input];
  if (field === "availableWeekdays" && /^I can train on (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)(, (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday))*$/.test(input))
    value = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].flatMap((day, i) => input.includes(day) ? [i] : []);
  if (value === undefined) return null;
  return { reply: "Got it.", patch: { [field]: value }, evidence: { [field]: input } };
}
