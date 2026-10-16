import {
  chatText, hasFact, memberQuestions, missingFacts, nextChatQuestion, trainingFields, nutritionFields,
  type ChatData, type ChatReply, type ChatPreference,
} from "./onboarding-chat.ts";
import { decisionPermissionUnclear, normalizeAnswer, preferenceIntent, refusesDecision, statedMinutes, statedWeekdays, suggestedWeekdays } from "./onboarding-language.ts";
import type { Specialty } from "./setup-assistant.ts";

type Question = { field: string; text: string; proposal?: boolean };
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const preferenceFields = new Set([...trainingFields, ...nutritionFields, "allergens", "nutritionNotes"]);
const defaults: Record<string, number> = { daysPerWeek: 3, maxSessionMinutes: 45, cookingMinutes: 20 };
const state = (c: ChatData) => c.dialogue ??= { preferences: {}, attempts: {} };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const quantified = (text: string) => /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|half|hour|couple|few|less|more|most|least|maximum|minimum)\b/.test(normalizeAnswer(text));
function preferenceSubject(text: string, current: string) {
  if (/\b(?:how many|days (?:a|per) week|frequency|(?:[1-7]|one|two|three|four|five|six|seven) (?:days|sessions))\b/i.test(text)) return "daysPerWeek";
  if (/\b(?:cook|cooking)\b/i.test(text)) return "cookingMinutes";
  if (/\b(?:how long|session length|minutes|duration)\b/i.test(text)) return "maxSessionMinutes";
  if (/\b(?:days|schedule|weekdays|weekends)\b/i.test(text)) return "availableWeekdays";
  return current;
}
function remember(c: ChatData, field: string, value: unknown, evidence: string, messageId: string, at: string) {
  if (same(c.facts[field], value) && c.memory[field] && !c.memory[field]?.origin) return;
  c.facts[field] = value;
  c.memory[field] = { evidence, messageId, at };
  c.skipped = c.skipped.filter(key => key !== field);
  delete state(c).preferences[field];
  delete state(c).attempts[field];
}
function preference(c: ChatData, field: string, status: ChatPreference["status"], evidence: string, messageId: string, at: string) {
  if (!preferenceFields.has(field)) return;
  const old = state(c).preferences[field];
  state(c).preferences[field] = { status, evidence: evidence.slice(0, 400), messageId, at,
    ...(field === "availableWeekdays" && ["delegated", "recommendation"].includes(status) ? { available: old?.available ?? c.facts.availableWeekdays ?? [0, 1, 2, 3, 4, 5, 6] } : {}),
    ...(old?.messageId === messageId && old.status === status && old.value !== undefined ? { value: old.value } : {}),
  };
  if (["unknown", "deferred"].includes(status) || !(field in defaults || field === "availableWeekdays")) {
    // Unknown/deferred personal details remain missing; review/application gates are unchanged.
    if (!hasFact(c.facts, field)) c.skipped = [...new Set([...c.skipped, field])];
  }
}
function recommendations(c: ChatData): string[] {
  const notices: string[] = [];
  for (const [field, choice] of Object.entries(state(c).preferences)) {
    if (!["delegated", "recommendation"].includes(choice.status)) continue;
    const explicit = c.memory[field]?.messageId === choice.messageId && !c.memory[field]?.origin ? c.facts[field] : undefined;
    // A stated limit or preference beats a generic starting point. If a numeric
    // constraint needs semantic extraction, do not fill the field before the model
    // can interpret it (e.g. "you decide, but at most 30 minutes").
    let value = field === "availableWeekdays" ? suggestedWeekdays(choice.available ?? [], c.facts.daysPerWeek)
      : explicit ?? choice.value ?? (quantified(choice.evidence) ? undefined : defaults[field]);
    if (field === "daysPerWeek" && explicit === undefined && typeof value === "number" && c.facts.availableWeekdays?.length)
      value = Math.min(value, c.facts.availableWeekdays.length);
    if (value === undefined) continue;
    if (choice.status === "recommendation" && same(choice.value, value) || choice.status === "delegated" && same(c.facts[field], value) && c.memory[field]?.origin === "suggested") continue;
    choice.value = value;
    if (choice.status === "delegated") {
      c.facts[field] = value;
      c.memory[field] = { evidence: choice.evidence, messageId: choice.messageId, at: choice.at, origin: "suggested" };
      c.skipped = c.skipped.filter(key => key !== field);
      delete state(c).attempts[field];
    }
    if (field === "availableWeekdays") {
      const names = [1, 2, 3, 4, 5, 6, 0].filter(day => (value as number[]).includes(day)).map(day => dayNames[day]);
      notices.push(`I'd suggest ${names.join(", ")} for your ${c.facts.daysPerWeek} training days. You can change those.`);
    } else if (field === "daysPerWeek") notices.push(`I'd suggest ${value} training days a week to start. You can change that.`);
    else notices.push(`I'd suggest ${value} minutes ${field === "cookingMinutes" ? "for cooking" : "per session"}. You can change that.`);
  }
  return notices;
}

/** Ground common replies before inference so the model sees the same updated state as the server. */
export function prepareChatTurn(c: ChatData, question: Question, text: string, messageId: string, at: string, nutrition: boolean): string[] {
  if (c.audience !== "member") return [];
  // A yes belongs to a specific offered choice, never to health/age/consent or an old proposal.
  const proposal = state(c).preferences[question.field];
  if (question.proposal && proposal?.status === "recommendation" && proposal.value !== undefined &&
    /^(?:yes|yeah|yep|sure|ok(?:ay)?|sounds good|that works(?: for me)?|go with that|let's do that|نعم|تمام)[.! ]*$/i.test(text.trim())) {
    const value = proposal.value;
    remember(c, question.field, value, text, messageId, at);
    state(c).preferences[question.field] = { ...proposal, status: "accepted", evidence: text, messageId, at };
    c.memory[question.field]!.origin = "suggested";
    return [question.field === "availableWeekdays" ? "We'll use those days as your starting schedule." : "We'll use that as your starting preference."];
  }
  if (refusesDecision(text)) {
    const field = preferenceSubject(text, question.field);
    const old = state(c).preferences[field];
    if (old && ["delegated", "recommendation"].includes(old.status)) {
      if (c.memory[field]?.origin === "suggested") { delete c.facts[field]; delete c.memory[field]; }
      delete state(c).preferences[field];
    }
  }
  // Recover a legacy rejected weekday answer on continuation, retaining its original provenance.
  if (!hasFact(c.facts, "availableWeekdays") && question.field === "availableWeekdays") {
    let asked: string | undefined;
    for (const message of c.messages.slice(-40)) {
      if (message.id === messageId) break;
      if (message.from === "assistant") asked = message.questionField ?? (message.text === memberQuestions.availableWeekdays ? "availableWeekdays" : undefined);
      else if ((message.questionField ?? asked) === "availableWeekdays") {
        const days = statedWeekdays(message.text);
        if (days) remember(c, "availableWeekdays", days, message.text, message.id, message.at);
      }
    }
  }
  if (question.field === "availableWeekdays" || /\b(?:train|training|gym|work out|available|actually|instead|can't|cannot)\b/i.test(text)) {
    const days = statedWeekdays(text, c.dialogue?.preferences.availableWeekdays?.available ?? c.facts.availableWeekdays);
    if (days) remember(c, "availableWeekdays", days, text, messageId, at);
  }
  if (question.field === "maxSessionMinutes" || nutrition && question.field === "cookingMinutes") {
    const otherTopic = question.field === "maxSessionMinutes" ? /\b(?:cook|cooking)\b/i.test(text) : /\b(?:train|training|workout|session)\b/i.test(text);
    const minutes = otherTopic ? undefined : statedMinutes(text);
    const maximum = question.field === "cookingMinutes" ? 1440 : 180;
    const minimum = question.field === "cookingMinutes" ? 1 : 15;
    if (minutes !== undefined && minutes >= minimum && minutes <= maximum) remember(c, question.field, minutes, text, messageId, at);
  }
  const intent = preferenceIntent(text);
  if (intent && (trainingFields.includes(question.field) || nutrition && preferenceFields.has(question.field))) {
    // A recommendation request for another topic must not change the currently asked preference.
    const explicitField = preferenceSubject(text, question.field);
    preference(c, explicitField, intent, text, messageId, at);
  }
  // Wait until all semantic patches have been grounded before choosing defaults.
  // A later clause may constrain the decision even when the fast path cannot read it.
  return [];
}

/** Preserve deterministic interpretation when a model omits or contradicts the same latest answer. */
export function preservePreparedFacts(c: ChatData, prepared: ChatData, messageId: string, answer?: ChatReply) {
  if (c.audience !== "member") return;
  const latestMessage = prepared.messages.slice().reverse().find(message => message.id === messageId);
  const latest = latestMessage?.text ?? "";
  const asked = latestMessage?.questionField ?? prepared.lastQuestion?.field ?? "";
  const recommended = new Map(Object.entries(prepared.dialogue?.preferences ?? {}).filter(([, choice]) => choice.messageId === messageId && choice.status === "recommendation"));
  for (const choice of answer?.preferences ?? []) {
    if (choice.status !== "recommendation" || !preferenceFields.has(choice.field) || !latest || !normalizeAnswer(latest).includes(normalizeAnswer(choice.evidence))) continue;
    if (choice.field !== asked && preferenceSubject(choice.evidence, asked) !== choice.field) continue;
    if (refusesDecision(latest) || preferenceIntent(choice.evidence) === "delegated") continue;
    recommended.set(choice.field, { ...choice, messageId, at: latestMessage?.at ?? c.memory[choice.field]?.at ?? "" });
  }
  if (answer?.intent === "recommendation" && latest) {
    const field = preferenceSubject(latest, asked);
    if (field in defaults && Object.hasOwn(answer.patch, field) && !recommended.has(field) && preferenceIntent(latest) !== "delegated" && !refusesDecision(latest))
      recommended.set(field, { status: "recommendation", evidence: latest.slice(0, 400), messageId, at: latestMessage?.at ?? c.memory[field]?.at ?? "" });
  }
  // A model can propose a value and accidentally put it in patch. Keep that value
  // as a proposal, restoring any previously saved preference until it is accepted.
  // Literal latest-message constraints already prepared by code are retained.
  for (const [field, choice] of recommended) {
    if (prepared.memory[field]?.messageId === messageId && !prepared.memory[field]?.origin) continue;
    const proposed = c.memory[field]?.messageId === messageId ? c.facts[field] : undefined;
    if (prepared.facts[field] === undefined) delete c.facts[field]; else c.facts[field] = structuredClone(prepared.facts[field]);
    if (prepared.memory[field] === undefined) delete c.memory[field]; else c.memory[field] = structuredClone(prepared.memory[field]!);
    state(c).preferences[field] = { ...choice, ...(typeof proposed === "number" ? { value: proposed } : {}) };
  }
  for (const field of Object.keys(prepared.memory)) {
    if (prepared.memory[field]?.messageId !== messageId) continue;
    // A model-grounded explicit value from this turn supersedes a generic default.
    if (prepared.memory[field]?.origin === "suggested" && c.memory[field]?.messageId === messageId && !c.memory[field]?.origin) continue;
    c.facts[field] = prepared.facts[field];
    c.memory[field] = structuredClone(prepared.memory[field]!);
    c.skipped = c.skipped.filter(key => key !== field);
    const choice = prepared.dialogue?.preferences[field];
    if (choice) state(c).preferences[field] = structuredClone(choice);
  }
}

const help: Record<string, string> = {
  availableWeekdays: "You can say weekdays, weekends, any day, or ask me to choose within the days you're free.",
  daysPerWeek: "Roughly how many sessions fit your week? You can also ask me to suggest a starting point.",
  maxSessionMinutes: "Would half an hour or an hour fit better, or would you like me to suggest a session length?",
  equipment: "Will you train at a gym, at home with some equipment, or using bodyweight?",
  age: "I need your actual age to finish the profile. You can leave it for later if you prefer.",
  limitations: "Tell me about any injuries or movements to avoid, or say none if that applies. We can leave this for later.",
};

/** One structured model call; local reconciliation chooses a useful, unresolved next question. */
export function finishChatTurn(c: ChatData, answer: ChatReply, asked: Question, text: string, messageId: string, at: string,
  specialties: readonly Specialty[], nutrition: boolean, preparedNotices: string[] = []): { reply: string; question: Question | undefined } {
  const notices = [...preparedNotices];
  if (c.audience === "member") {
    for (const choice of answer.preferences ?? []) {
      if (!preferenceFields.has(choice.field) || !nutrition && !trainingFields.includes(choice.field)) continue;
      if (!normalizeAnswer(text).includes(normalizeAnswer(choice.evidence))) continue;
      // A bare "you choose" or "later" belongs only to the actual question. Multi-field choices
      // must name their subject; model-generated text or uploaded material cannot grant delegation.
      const names: Record<string, RegExp> = { availableWeekdays: /\b(?:days|schedule|weekdays|weekends)\b/i, daysPerWeek: /\b(?:how many|frequency|times|sessions|days a week)\b/i, maxSessionMinutes: /\b(?:duration|minutes|long|session|time)\b/i, cookingMinutes: /\b(?:cook|cooking)\b/i };
      if (choice.field !== asked.field && !names[choice.field]?.test(choice.evidence)) continue;
      if (refusesDecision(text)) continue;
      const explicit = preferenceIntent(choice.evidence);
      // Let the active model understand paraphrases/languages beyond the local fast path.
      // Uncertainty or a request for advice never grants authority to apply a preference.
      if (choice.status === "delegated" && (explicit === "unknown" || explicit === "recommendation" || explicit === "deferred")) continue;
      if (choice.status === "delegated" && decisionPermissionUnclear(text)) continue;
      if (!explicit && choice.status === "delegated" && answer.intent !== "delegate") continue;
      if (!explicit && choice.status === "recommendation" && answer.intent !== "recommendation") continue;
      if (["unknown", "deferred"].includes(choice.status) && !explicit && answer.intent !== "defer") continue;
      preference(c, choice.field, choice.status, choice.evidence, messageId, at);
    }
    notices.push(...recommendations(c));
  }
  const pendingProposal = Object.entries(c.dialogue?.preferences ?? {}).find(([, choice]) => choice.status === "recommendation" && choice.messageId === messageId && choice.value !== undefined);
  if (pendingProposal) {
    const [field] = pendingProposal;
    return { reply: chatText(notices.length ? [...new Set(notices)].join(" ") : answer.reply), question: { field, text: "Would that work for you, or would you prefer something different?", proposal: true } };
  }
  let remaining = missingFacts(c, nutrition);
  const currentMissing = remaining.includes(asked.field) || asked.field.startsWith("coaching.") && nextChatQuestion(c, specialties, nutrition).field === asked.field;
  const madeProgress = Object.values(c.memory).some(memory => memory.messageId === messageId) || Object.values(c.dialogue?.preferences ?? {}).some(choice => choice.messageId === messageId);
  if (currentMissing && !madeProgress && !c.skipped.includes(asked.field) && !["question", "clarify"].includes(answer.intent ?? "")) {
    const attempts = state(c).attempts[asked.field] = (state(c).attempts[asked.field] ?? 0) + 1;
    if (attempts >= 2) {
      c.skipped = [...new Set([...c.skipped, asked.field])];
      notices.push("Let's leave that detail open for now and come back to it before finishing.");
    }
  } else if (!currentMissing) delete state(c).attempts[asked.field];
  let question = nextChatQuestion(c, specialties, nutrition);
  remaining = missingFacts(c, nutrition);
  // The model may follow the person's topic instead of the form order, but may never
  // re-ask an answered/deferred field or mark a required field complete by choosing it.
  const eligible = c.audience === "member" && answer.questionField && remaining.includes(answer.questionField) && !c.skipped.includes(answer.questionField);
  if (eligible) question = { field: answer.questionField!, text: memberQuestions[answer.questionField!]! };
  if (answer.questionField === question.field && answer.question && !(c.mode === "website" && (question.field.startsWith("website.") || ["priceAed", "baseTrainingPriceAed"].includes(question.field)))) question.text = chatText(answer.question, question.text);
  if (question.field === asked.field && state(c).attempts[asked.field] === 1 && question.text === asked.text)
    question.text = help[asked.field] ?? "What would help make this easier to answer? You can give an example or leave it for later.";
  if (remaining.includes("availableWeekdays") && !c.skipped.includes("availableWeekdays") && c.facts.availableWeekdays?.length < c.facts.daysPerWeek)
    question = { field: "availableWeekdays", text: `You mentioned ${c.facts.daysPerWeek} sessions but only ${c.facts.availableWeekdays.length} available days. Would fewer sessions or another available day fit better?` };
  const reply = chatText(notices.length ? [...new Set(notices)].join(" ") : answer.reply);
  // Answer a genuine question without immediately repeating the form question. Its referent
  // stays in lastQuestion, so a subsequent short answer still has the correct context.
  if (answer.intent === "question" && !answer.question && !notices.length) return { reply, question: undefined };
  return { reply, question };
}

/** Durable facts/choices outlive the recent transcript. No separate summarisation model call. */
export function onboardingContext(c: ChatData, question: Question, nutrition: boolean) {
  const unresolved = missingFacts(c, nutrition);
  const evidence = Object.fromEntries(Object.entries(c.memory).slice(0, 40).map(([field, memory]) => [field,
    { quote: memory.evidence.slice(0, 220), ...(memory.origin ? { origin: memory.origin } : {}) }]));
  return {
    asked: question.field, unresolved, deferred: c.skipped.slice(0, 80), evidence,
    choices: Object.fromEntries(Object.entries(c.dialogue?.preferences ?? {}).slice(0, 24).map(([field, choice]) => [field,
      { status: choice.status, quote: choice.evidence.slice(0, 220), ...(choice.available ? { available: choice.available } : {}), ...(choice.value !== undefined ? { value: choice.value } : {}) }])),
    attempts: c.dialogue?.attempts ?? {},
    next: nextChatQuestion(c, [], nutrition).field,
    schedule: c.audience === "member" && c.facts.availableWeekdays ? {
      trainingDays: c.facts.daysPerWeek, days: c.facts.availableWeekdays,
      origin: c.memory.availableWeekdays?.origin ?? "stated availability",
    } : undefined,
  };
}

export function recentOnboardingTurns(c: ChatData) {
  // Take complete person/assistant turns; an extra assistant bubble must not halve memory.
  const turns: Array<Array<{ from: string; text: string; questionField?: string }>> = [];
  for (const message of c.messages) {
    if (message.from === "person" || !turns.length) turns.push([]);
    turns.at(-1)!.push({ from: message.from, text: message.text.slice(0, message === c.messages.at(-1) ? 4000 : 700), ...(message.questionField ? { questionField: message.questionField } : {}) });
  }
  const chosen = turns.slice(-6);
  while (JSON.stringify(chosen).length > 9000 && chosen.length > 1) chosen.shift();
  return chosen.flat();
}

/** Known app actions do not require another model purchase or an unverifiable model promise. */
export function onboardingCommand(input: string): "start" | "training" | "nutrition" | undefined {
  const text = normalizeAnswer(input).replace(/[.!?]+$/g, "");
  if (/\b(?:don't|do not|not yet|before|if|maybe)\b/.test(text)) return;
  if (/^(?:ok(?:ay)?[ ,]+)?(?:let'?s (?:get started|start|begin|do it)|get started|start (?:my |the )?(?:plan|training|workout)|i'?m ready(?: to start)?|go ahead|save my profile|confirm my (?:profile|answers))$/.test(text)) return "start";
  if (/\b(?:where|open|show|see|check|take me|go to)\b/.test(text)) {
    if (/\b(?:nutrition|meal plan|food plan)\b/.test(text)) return "nutrition";
    if (/\b(?:training|workouts?|training plan|my plan)\b/.test(text)) return "training";
  }
}
