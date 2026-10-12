import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyChat, mergeChatFacts, nextChatQuestion, profileReady, type ChatReply } from "../packages/domain/src/onboarding-chat.ts";
import { prepareChatTurn, preservePreparedFacts, finishChatTurn, onboardingContext, recentOnboardingTurns, onboardingCommand } from "../packages/domain/src/onboarding-context.ts";
import { statedWeekdays, suggestedWeekdays, preferenceIntent, statedMinutes } from "../packages/domain/src/onboarding-language.ts";

const at = "2026-10-12T04:00:00.000Z";
const base = () => {
  const c = emptyChat("member");
  c.facts = { goal: "Lose fat and gain muscle", experience: "beginner", daysPerWeek: 4 };
  c.lastQuestion = nextChatQuestion(c, []);
  return c;
};
function turn(c: ReturnType<typeof base>, text: string, answer: ChatReply = { reply: "Understood.", patch: {}, evidence: {} }) {
  const id = "turn-" + c.messages.length, q = c.lastQuestion!;
  c.messages.push({ id, from: "person", text, at, questionField: q.field });
  const notices = prepareChatTurn(c, q, text, id, at, false);
  const prepared = structuredClone(c), merged = mergeChatFacts(c, answer, text, id, at, []);
  preservePreparedFacts(merged, prepared, id, answer); Object.assign(c, merged);
  const result = finishChatTurn(c, answer, q, text, id, at, [], false, notices);
  c.messages.push({ id: id + "reply", from: "assistant", text: result.reply, at });
  if (result.question) { c.lastQuestion = result.question; c.messages.push({ id: id + "question", from: "assistant", text: result.question.text, at, questionField: result.question.field }); }
  return result;
}

for (const [text, expected] of [
  ["weekdays mostly", [1, 2, 3, 4, 5]], ["All weekdays. you can fix the time", [1, 2, 3, 4, 5]],
  ["weekends", [0, 6]], ["Monday-Friday", [1, 2, 3, 4, 5]], ["Fri through Mon", [0, 1, 5, 6]],
  ["any day except Friday", [0, 1, 2, 3, 4, 6]], ["weekdays but not Monday or Wednesday", [2, 4, 5]],
  ["not weekdays, weekends only", [0, 6]], ["Sunday to Thursday", [0, 1, 2, 3, 4]],
  ["كل يوم باستثناء الجمعة", [0, 1, 2, 3, 4, 6]], ["Maybe Monday or Friday?", undefined],
  ["I used to train on Monday", undefined], ["not Friday", undefined],
] as const) test(`availability understands ${text}`, () => assert.deepEqual(statedWeekdays(text), expected));

test("exclusions amend known availability without making excluded days available", () => {
  assert.deepEqual(statedWeekdays("actually not Friday", [1, 2, 3, 4, 5]), [1, 2, 3, 4]);
  assert.deepEqual(statedWeekdays("not Monday", [1]), []);
  assert.deepEqual(suggestedWeekdays([1, 2, 3, 4, 5], 4), [1, 2, 4, 5]);
  assert.equal(suggestedWeekdays([0, 6], 4), undefined);
});

test("the reported loop accepts weekdays then chooses a balanced four-day schedule", () => {
  const c = base();
  turn(c, "weekdays mostly", { reply: "Which exact days?", patch: {}, evidence: {}, questionField: "availableWeekdays", question: "Which days usually work for you?" });
  assert.deepEqual(c.facts.availableWeekdays, [1, 2, 3, 4, 5]);
  assert.equal(c.lastQuestion?.field, "maxSessionMinutes");
  const result = turn(c, "you let me know which days i should go");
  assert.deepEqual(c.facts.availableWeekdays, [1, 2, 4, 5]);
  assert.match(result.reply, /Monday, Tuesday, Thursday, Friday/);
  assert.equal(c.memory.availableWeekdays.origin, "suggested");
  assert.equal(c.lastQuestion?.field, "maxSessionMinutes");
  assert.equal(c.facts.daysPerWeek, 4);
});

test("legacy stalled threads recover the person's earlier rejected availability", () => {
  const c = base();
  c.messages = [{ id: "q", from: "assistant", text: "Which days usually work for you?", at }, { id: "old", from: "person", text: "weekdays mostly", at }];
  turn(c, "you decide");
  assert.deepEqual(c.facts.availableWeekdays, [1, 2, 4, 5]);
  assert.deepEqual(c.dialogue?.preferences.availableWeekdays.available, [1, 2, 3, 4, 5]);
});

test("uncertainty, advice, delegation and refusal have different consequences", () => {
  for (const [text, expected] of [["not sure", "unknown"], ["what do you recommend?", "recommendation"], ["you decide", "delegated"], ["whatever works best", "delegated"], ["don't choose for me", undefined], ["I want to choose", undefined]] as const)
    assert.equal(preferenceIntent(text), expected, text);
  const c = base(); c.lastQuestion = { field: "maxSessionMinutes", text: "How much time?" };
  turn(c, "what do you recommend?");
  assert.equal(c.facts.maxSessionMinutes, undefined);
  assert.equal(c.dialogue?.preferences.maxSessionMinutes.value, 45);
  assert.equal(c.lastQuestion.proposal, true);
  turn(c, "sounds good");
  assert.equal(c.facts.maxSessionMinutes, 45);
  assert.equal(c.dialogue?.preferences.maxSessionMinutes.status, "accepted");
  const unsure = base(); unsure.lastQuestion = { field: "age", text: "How old are you?" };
  turn(unsure, "not sure");
  assert.equal(unsure.facts.age, undefined);
  assert.equal(profileReady(unsure), false);
});

test("the active model can recognize a contextual delegation outside English shortcuts", () => {
  const c = base(); c.lastQuestion = { field: "maxSessionMinutes", text: "How much time?" };
  turn(c, "Tú decides la duración", { reply: "Te propongo una duración inicial.", patch: {}, evidence: {}, intent: "delegate", preferences: [{ field: "maxSessionMinutes", status: "delegated", evidence: "Tú decides la duración" }] });
  assert.equal(c.facts.maxSessionMinutes, 45);
  const denied = base(); denied.lastQuestion = { field: "maxSessionMinutes", text: "How much time?" };
  turn(denied, "don't choose for me", { reply: "Understood.", patch: {}, evidence: {}, intent: "delegate", preferences: [{ field: "maxSessionMinutes", status: "delegated", evidence: "choose for me" }] });
  assert.equal(denied.facts.maxSessionMinutes, undefined);
});

test("a correction replaces the suggestion and frequency conflicts stay explicit", () => {
  const c = base(); turn(c, "All weekdays, you choose");
  turn(c, "Actually Friday is not available", { reply: "We can adjust that.", patch: { availableWeekdays: [1, 2, 3, 4] }, evidence: { availableWeekdays: "Actually Friday is not available" } });
  // Postfix negations are not interpreted as availability by the local parser.
  assert.ok(!c.facts.availableWeekdays.includes(5));
  const conflict = base(); turn(conflict, "weekends only");
  assert.equal(conflict.facts.daysPerWeek, 4);
  assert.match(conflict.lastQuestion?.text ?? "", /4 sessions but only 2/);
});

test("repeated nonanswers advance without falsifying completion, and a direct question is answered first", () => {
  const c = base(); turn(c, "hmm");
  assert.notEqual(c.lastQuestion!.text, "Which days usually work for you?");
  turn(c, "hmm again");
  assert.equal(c.lastQuestion!.field, "maxSessionMinutes");
  assert.ok(c.skipped.includes("availableWeekdays")); assert.equal(profileReady(c), false);
  const current = c.lastQuestion;
  const answer = turn(c, "Why does session length matter?", { reply: "It helps fit the plan into the time you actually have.", patch: {}, evidence: {}, intent: "question" });
  assert.equal(answer.question, undefined); assert.deepEqual(c.lastQuestion, current);
});

test("duration language, compact memory and navigation use bounded deterministic work", () => {
  assert.equal(statedMinutes("half an hour"), 30); assert.equal(statedMinutes("an hour and a half"), 90);
  const c = base(); turn(c, "Weekdays, you choose");
  for (let i = 0; i < 40; i++) c.messages.push({ id: String(i), from: i % 3 === 0 ? "person" : "assistant", text: "x".repeat(600), at });
  assert.deepEqual(onboardingContext(c, c.lastQuestion!, false).schedule?.days, [1, 2, 4, 5]);
  assert.ok(JSON.stringify(recentOnboardingTurns(c)).length <= 9000);
  assert.equal(recentOnboardingTurns(c)[0]?.from, "person");
  for (const [text, expected] of [["let's get started.", "start"], ["where is training", "training"], ["check my training plan", "training"], ["open nutrition", "nutrition"], ["don't start my plan", undefined]] as const) assert.equal(onboardingCommand(text), expected);
});

test("complex availability and competing durations never force a guessed fact", () => {
  assert.deepEqual(statedWeekdays("I'm 28, a beginner. Build sustainable strength. 3 days a week: Monday, Wednesday, Friday. 45 minutes. Dumbbells. No injuries or limitations."), [1, 3, 5]);
  for (const text of [
    "I can train weekdays but not every day",
    "I cannot do Monday, Tuesday works",
    "Monday is a bad day",
    "Monday no longer works",
    "I am busy on Monday and free on Tuesday",
  ]) assert.equal(statedWeekdays(text, [1, 2, 3, 4, 5]), undefined, text);
  for (const text of [
    "I have one hour of travel so 30 minutes for training",
    "I can spare an hour but only 30 minutes on Fridays",
  ]) assert.equal(statedMinutes(text), undefined, text);
  const c = base(); c.lastQuestion = { field: "maxSessionMinutes", text: "How much time?" };
  turn(c, "I have one hour of travel so 30 minutes for training", {
    reply: "We'll fit training into 30 minutes.", patch: { maxSessionMinutes: 30 },
    evidence: { maxSessionMinutes: "30 minutes for training" }, intent: "answer",
  });
  assert.equal(c.facts.maxSessionMinutes, 30, "The model's specific training-time evidence survives reconciliation.");
});

test("delegated defaults respect explicit limits and the available number of days", () => {
  for (const [field, text, value] of [
    ["daysPerWeek", "You choose, but I can only manage 2 days a week", 2],
    ["maxSessionMinutes", "You decide, I have at most 30 minutes", 30],
  ] as const) {
    const c = emptyChat("member"); c.lastQuestion = { field, text: "What fits?" };
    const result = turn(c, text, { reply: "That fits.", patch: { [field]: value }, evidence: { [field]: text }, intent: "delegate", preferences: [{ field, status: "delegated", evidence: text }] });
    assert.equal(c.facts[field], value, text);
    assert.doesNotMatch(result.reply, /3 training days|45 minutes/);
  }
  const incomplete = emptyChat("member"); incomplete.lastQuestion = { field: "daysPerWeek", text: "How many days?" };
  turn(incomplete, "You choose, but no more than 2 days");
  assert.equal(incomplete.facts.daysPerWeek, undefined, "An unparsed upper bound cannot become a three-day default.");
  const weekend = emptyChat("member"); weekend.facts.availableWeekdays = [0, 6]; weekend.lastQuestion = { field: "daysPerWeek", text: "How many days?" };
  turn(weekend, "You decide");
  assert.equal(weekend.facts.daysPerWeek, 2);
});

test("asking who decides and hypothetical permission do not delegate a choice", () => {
  for (const text of ["Do you decide or should I?", "Should I let you choose?", "If you decide for me, what happens?"]) {
    assert.equal(preferenceIntent(text), undefined, text);
    const c = base(); c.lastQuestion = { field: "maxSessionMinutes", text: "How much time?" };
    turn(c, text, { reply: "You can choose, or ask for a suggestion.", patch: {}, evidence: {}, intent: "delegate", preferences: [{ field: "maxSessionMinutes", status: "delegated", evidence: text }] });
    assert.equal(c.facts.maxSessionMinutes, undefined, text);
  }
  assert.equal(preferenceIntent("Can you choose for me?"), "delegated");
});

test("a model recommendation patch stays a proposal until its specific acceptance", () => {
  const c = base(); c.facts.maxSessionMinutes = 60; c.memory.maxSessionMinutes = { evidence: "One hour", messageId: "earlier", at };
  c.lastQuestion = { field: "maxSessionMinutes", text: "Would you like to change the session length?" };
  turn(c, "Would 30 minutes work?", { reply: "I'd suggest 30 minutes to start.", patch: { maxSessionMinutes: 30 }, evidence: { maxSessionMinutes: "30 minutes" }, intent: "recommendation", preferences: [{ field: "maxSessionMinutes", status: "recommendation", evidence: "Would 30 minutes work?" }] });
  assert.equal(c.facts.maxSessionMinutes, 60, "Advice has not changed the saved preference.");
  assert.equal(c.dialogue?.preferences.maxSessionMinutes.value, 30);
  assert.equal(c.lastQuestion?.proposal, true);
  turn(c, "sounds good");
  assert.equal(c.facts.maxSessionMinutes, 30);
  assert.equal(c.dialogue?.preferences.maxSessionMinutes.status, "accepted");
  const noChoice = base(); noChoice.lastQuestion = { field: "maxSessionMinutes", text: "How much time?" };
  turn(noChoice, "Would 30 minutes work?", { reply: "I'd suggest 30 minutes.", patch: { maxSessionMinutes: 30 }, evidence: { maxSessionMinutes: "30 minutes" }, intent: "recommendation" });
  assert.equal(noChoice.facts.maxSessionMinutes, undefined, "An omitted preferences array must not turn advice into acceptance.");
  assert.equal(noChoice.dialogue?.preferences.maxSessionMinutes.value, 30);
});
