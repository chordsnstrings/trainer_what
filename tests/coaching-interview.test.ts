import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyChat, nextChatQuestion, parseChatReply } from "../packages/domain/src/onboarding-chat.ts";
import { activeCoachingTopics, coachingCoverage, coachingField, coachingInterviewContext, coachingTopics, mergeCoachingInterview, nextCoachingQuestion } from "../packages/domain/src/coaching-interview.ts";

const at = "2026-10-08T12:00:00Z";
const record = (c: ReturnType<typeof emptyChat>, point: string, evidence: string) => mergeCoachingInterview(c, { answers: [{ point, evidence }] }, evidence, "message", at, ["source"]);
function throughSession(c: ReturnType<typeof emptyChat>) {
  const evidence = "I coach CrossFit and choose varied strength, skills and conditioning for all-round capacity.";
  mergeCoachingInterview(c, { methods: { selected: ["crossfit"], evidence } }, evidence, "style", at, ["source"]);
  for (const t of activeCoachingTopics(c).slice(0, 5)) for (const p of t.points) record(c, p.id, "A detailed synthetic answer for " + p.id + ".");
}

test("trainer onboarding goes beyond identity into programming before commercial setup; member intake stays separate", () => {
  const c = emptyChat("coach");
  assert.equal(nextChatQuestion(c, []).field, "audience");
  c.facts.audience = "Busy beginners";
  assert.equal(nextChatQuestion(c, []).field, "coaching.philosophy.priorities");
  assert.equal(nextChatQuestion(emptyChat("coach", "teach"), []).field, "coaching.philosophy.priorities");
  assert.equal(nextChatQuestion(emptyChat("member"), []).field, "goal");
  assert.equal(coachingCoverage(c).total, 18);
  assert.ok(activeCoachingTopics(c).some(t => t.id === "weekly"));
  assert.ok(activeCoachingTopics(c).some(t => t.id === "session_example"));
});

test("CrossFit and heavy strength take different relevant branches, including mixed and corrected methods", () => {
  const c = emptyChat("coach", "teach"); throughSession(c);
  assert.equal(nextChatQuestion(c, []).field, "coaching.crossfit_stimulus.design");
  assert.match(nextChatQuestion(c, []).text, /stimulus.*time/);
  assert.equal(coachingCoverage(c).total, 21);
  assert.ok(!activeCoachingTopics(c).some(t => t.id === "strength_heavy"));
  const mixed = "I coach both CrossFit and heavy strength with different groups.";
  mergeCoachingInterview(c, { methods: { selected: ["crossfit", "strength"], evidence: mixed } }, mixed, "mixed", at, ["mixed-source"]);
  assert.ok(activeCoachingTopics(c).some(t => t.id === "strength_heavy"));
  const corrected = "I no longer coach CrossFit. I only programme heavy strength sets now.";
  mergeCoachingInterview(c, { methods: { selected: ["strength"], evidence: corrected } }, corrected, "new-method", at, ["strength-source"]);
  assert.equal(nextChatQuestion(c, []).field, "coaching.strength_heavy.loading");
  assert.match(nextChatQuestion(c, []).text, /heavy sets.*RPE/);
  assert.ok(!activeCoachingTopics(c).some(t => t.id === "crossfit_stimulus"));
});

test("several evidenced decisions cover separate points; partial answers keep the relevant follow-up", () => {
  const c = emptyChat("coach", "teach");
  const priority = "I prioritise consistent attendance because manageable training beats an ambitious plan people abandon.";
  const split = "I use three full-body days for beginners so each movement is practised regularly with rest days between.";
  const evidence = priority + " " + split;
  mergeCoachingInterview(c, { answers: [{ point: "philosophy.priorities", evidence: priority }, { point: "weekly.split", evidence: split }] }, evidence, "multi", at, ["teaching-id"]);
  assert.equal(nextCoachingQuestion(c)?.field, "coaching.philosophy.tradeoffs");
  assert.equal(coachingCoverage(c).topics.find(t => t.id === "weekly")?.status, "partial");
  assert.deepEqual(c.interview?.answers["weekly.split"]?.sourceIds, ["teaching-id"]);
  assert.equal(c.interview?.answers["weekly.split"]?.messageId, "multi");
  const changed = "I now use two full-body days for that group because a third day conflicts with their shift work.";
  record(c, "weekly.split", changed);
  assert.equal(c.interview?.answers["weekly.split"]?.evidence, changed);
});

test("hallucinated quotes, vague replies, unknown or inactive points, absent sources and member updates cannot create coverage", () => {
  const c = emptyChat("coach", "teach");
  record(c, "philosophy.priorities", "It depends on the client.");
  assert.equal(c.interview?.answers["philosophy.priorities"], undefined);
  const actual = "Which part should I answer first?";
  mergeCoachingInterview(c, { answers: [{ point: "weekly.split", evidence: "I use a three-day full-body split for beginners." }] }, actual, "bad", at, ["source"]);
  record(c, "invented.point", "An answer to a point that does not exist.");
  record(c, "crossfit_stimulus.design", "I choose a short AMRAP for this client's conditioning.");
  mergeCoachingInterview(c, { answers: [{ point: "weekly.split", evidence: actual }] }, actual, "no-source", at, []);
  assert.deepEqual(c.interview?.answers, {});
  const member = emptyChat("member"); record(member, "weekly.split", "I use three full-body days with rest days between.");
  assert.equal(member.interview, undefined);
});

test("deferral leaves a gap, answers clear it, and resuming returns to remaining points", () => {
  const c = emptyChat("coach", "teach");
  c.lastQuestion = nextChatQuestion(c, []);
  mergeCoachingInterview(c, { defer: { point: "philosophy.priorities", evidence: "skip" } }, "skip", "defer", at, []);
  assert.equal(nextChatQuestion(c, []).field, "coaching.philosophy.tradeoffs");
  assert.equal(c.interview?.answers["philosophy.priorities"], undefined);
  c.skipped = [];
  assert.equal(nextChatQuestion(c, []).field, "coaching.philosophy.priorities");
  c.skipped.push(coachingField("philosophy.priorities"));
  record(c, "philosophy.priorities", "I prioritise consistent practice with achievable progress over maximal effort every day.");
  assert.equal(c.skipped.length, 0);
});

test("coverage and method memory survive transcript removal and JSON persistence", () => {
  const c = emptyChat("coach", "teach"); throughSession(c);
  const persisted = JSON.parse(JSON.stringify({ ...c, messages: [], archived: 120 }));
  assert.equal(nextChatQuestion(persisted, []).field, "coaching.crossfit_stimulus.design");
  assert.equal(coachingCoverage(persisted).covered, 5);
  assert.match(coachingInterviewContext(persisted).covered["weekly.split"]!, /weekly.split/);
});

test("full coverage leads to review, never an endless seven-question cycle or automatic qualification", () => {
  const c = emptyChat("coach", "teach"); throughSession(c);
  for (const t of activeCoachingTopics(c)) for (const p of t.points) record(c, p.id, "A detailed synthetic response covering " + p.id + ".");
  assert.equal(nextChatQuestion(c, []).field, "coaching.review");
  assert.match(nextChatQuestion(c, []).text, /still needs those checks/);
  assert.equal(coachingCoverage(c).covered, 21);
  assert.deepEqual(c.compiledIds, []);
});

test("all deferred points remain incomplete and every new question fits the reply contract", () => {
  const c = emptyChat("coach", "teach");
  c.skipped = activeCoachingTopics(c).flatMap(t => t.points.map(p => coachingField(p.id)));
  assert.equal(nextChatQuestion(c, []).field, "coaching.review");
  assert.equal(coachingCoverage(c).covered, 0);
  assert.ok(coachingCoverage(c).topics.every(t => t.status === "deferred"));
  for (const t of coachingTopics) for (const p of t.points) {
    assert.ok(p.question.length <= 220, p.id);
    assert.ok(coachingField(p.id).length <= 50, p.id);
  }
  assert.equal(parseChatReply({ reply: "Let's get specific.", coaching: null }).coaching, undefined);
  assert.doesNotThrow(() => parseChatReply({ reply: "Let's get specific.", coaching: { answers: null, methods: null, defer: null } }));
});
