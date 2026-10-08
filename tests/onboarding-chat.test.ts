import { HOST_HEADERS, signHostRequest } from "../apps/api/src/host-routing.ts";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { putRecord } from "@trainer/db";
import { accountsContext, withEnv } from "./accounts-fixtures.ts";
import { OFFERED_DIRECTORY_SPECIALTIES } from "@trainer/contracts";
import { emptyChat, mergeChatFacts, nextChatQuestion, profileReady, chatText, quickChatReply } from "../packages/domain/src/onboarding-chat.ts";

const specialties = OFFERED_DIRECTORY_SPECIALTIES.map(({ id, label }) => ({ id, label }));
let ctx: Awaited<ReturnType<typeof accountsContext>>;
before(async () => { ctx = await accountsContext(); });
after(async () => { await ctx.close(); });
const call = (person: { cookie: string }, path: string, body?: any) => ctx.call(path, { cookie: person.cookie, body });
const snapshot = async (person: { cookie: string }) => {
  const r = await call(person, "/onboarding-chat");
  assert.equal(r.statusCode, 200, r.body); return r.json();
};
async function model<T>(answer: (input: any) => any | Promise<any>, run: (sent: any[]) => Promise<T>) {
  const original = globalThis.fetch, sent: any[] = [];
  return withEnv({ MODEL_BASE_URL: "https://onboarding-chat.invalid/v1", MODEL_API_KEY: "fixture", MODEL_NAME: "fixture-chat", MODEL_MAX_DAILY_CALLS: "1000" }, async () => {
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith("https://onboarding-chat.invalid")) return original(url, init);
      const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[1].content);
      sent.push(input);
      const reply = await answer(input);
      return Response.json({ usage: { prompt_tokens: 12, completion_tokens: 8 }, choices: [{ message: { content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] });
    };
    try { return await run(sent); } finally { globalThis.fetch = original; }
  });
}
const training = { age: 28, goal: "Build sustainable strength", experience: "beginner", daysPerWeek: 3, availableWeekdays: [1, 3, 5], maxSessionMinutes: 45, equipment: "Dumbbells", limitations: "No injuries or limitations" };
const trainingText = "I'm 28, a beginner. Build sustainable strength. 3 days a week: Monday, Wednesday, Friday. 45 minutes. Dumbbells. No injuries or limitations.";
const trainingReply = { reply: "That gives us a good starting point.", patch: training, evidence: Object.fromEntries(Object.keys(training).map(k => [k, k === "limitations" ? training.limitations : trainingText])) };
async function grant(person: any, type = "coaching") {
  const r = await call(person, "/privacy/consent", { type, granted: true });
  assert.equal(r.statusCode, 200, r.body);
}

test("grounded multi-answer memory rejects invented age, weekdays and undisclosed food fields", () => {
  const c = emptyChat("member"), at = new Date().toISOString();
  const reply = { reply: "OK", patch: { age: 27, daysPerWeek: 3, availableWeekdays: [1, 4], diet: "vegan" }, evidence: { age: "28", daysPerWeek: "three", availableWeekdays: "Monday and Friday", diet: "vegan" } };
  const saved = mergeChatFacts(c, reply, "I'm 28. I train three times, Monday and Friday. I'm vegan.", "one", at, specialties);
  assert.deepEqual(saved.facts, { daysPerWeek: 3 });
  assert.equal(saved.memory.daysPerWeek.messageId, "one");
  assert.deepEqual(c.facts, {});
  const ready = mergeChatFacts(c, trainingReply, trainingText, "two", at, specialties);
  assert.equal(profileReady(ready), true);
  assert.equal(nextChatQuestion(ready, specialties).field, "review");
  assert.equal(ready.facts.limitations, "No injuries or limitations");
});
test("phone copy is bounded and stripped of Markdown or vendor names", () => {
  assert.equal(chatText("**Got it.**"), "Got it.");
  assert.equal(chatText("Powered by OpenAI"), "Got it.");
  assert.ok(chatText("a".repeat(600)).length <= 360);
});
test("opening, resuming and pausing use no model calls", async () => {
  const owner = await ctx.person({ role: "owner", name: "Synthetic Chat Coach" });
  await model(() => { throw Error("Unexpected call"); }, async sent => {
    const a = await snapshot(owner), b = await snapshot(owner);
    assert.equal(a.id, b.id); assert.equal(a.version, b.version);
    const pause = await call(owner, "/onboarding-chat/actions", { id: randomUUID(), version: a.version, action: "pause" });
    assert.equal(pause.statusCode, 200, pause.body);
    assert.equal(pause.json().paused, true); assert.equal(sent.length, 0);
  });
});
test("one answer records several grounded coach facts and one billed request; replay is idempotent", async () => {
  const owner = await ctx.person({ role: "owner" }), c = await snapshot(owner);
  const text = "I'm Alex and I coach busy beginners in Dubai.";
  const body = { id: randomUUID(), version: c.version, text };
  await model(() => ({ reply: "Busy weeks need something realistic.", patch: { publicName: "Alex", audience: "busy beginners", city: "Dubai" }, evidence: { publicName: "Alex", audience: "busy beginners", city: "Dubai" } }), async sent => {
    const r = await call(owner, "/onboarding-chat/messages", body); assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().facts.city, "Dubai", r.body);
    assert.equal(r.json().memory.publicName.evidence, "Alex");
    const again = await call(owner, "/onboarding-chat/messages", body);
    assert.equal(again.statusCode, 200, again.body); assert.equal(sent.length, 1);
    assert.equal(again.json().messages.filter((m: any) => m.id === body.id).length, 1);
    const changed = await call(owner, "/onboarding-chat/messages", { ...body, text: "Different answer" });
    assert.equal(changed.statusCode, 409);
  });
});
test("Brain teaching is saved for batch review and does not approve or compile per message", async () => {
  const owner = await ctx.person({ role: "owner" }), c = await snapshot(owner);
  await model(() => ({ reply: "I've kept that with your teaching.", patch: {}, evidence: {}, questionField: "teaching", question: "How would you adapt that for someone training twice a week?" }), async sent => {
    const r = await call(owner, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, mode: "teach", text: "I increase the load only after clients complete all prescribed reps with good form." });
    assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().teachingIds.length, 1);
    assert.equal(r.json().compiledIds.length, 0); assert.equal(r.json().brain.rules.length, 0); assert.equal(sent.length, 1);
    const saved = await snapshot(owner);
    assert.equal(saved.teachingIds[0], r.json().teachingIds[0]);
  });
});
test("concurrent resend sees the pending turn without another model call", async () => {
  const owner = await ctx.person({ role: "owner" }), c = await snapshot(owner);
  const body = { id: randomUUID(), version: c.version, text: "I help beginners become confident in the gym." };
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  await model(async () => { enter(); await held; return { reply: "Got it.", patch: {}, evidence: {} }; }, async sent => {
    const first = call(owner, "/onboarding-chat/messages", body);
    await entered;
    try {
      const second = await call(owner, "/onboarding-chat/messages", body);
      assert.equal(second.statusCode, 200, second.body); assert.equal(second.json().pending.id, body.id); assert.equal(sent.length, 1);
    } finally { release(); }
    assert.equal((await first).statusCode, 200);
  });
});
test("malformed model output retains the saved message and exposes a recoverable error", async () => {
  const owner = await ctx.person({ role: "owner" }), c = await snapshot(owner), id = randomUUID();
  await model(() => "unreadable fixture", async sent => {
    const r = await call(owner, "/onboarding-chat/messages", { id, version: c.version, text: "I coach beginners." });
    assert.equal(r.statusCode, 200, r.body); assert.ok(r.json().error); assert.equal(r.json().pending, undefined);
    assert.ok(r.json().messages.some((m: any) => m.id === id)); assert.equal(sent.length, 1);
  });
});
test("member consent precedes messages; one conversation completes the real intake", async () => {
  const owner = await ctx.person({ role: "owner" }), member = await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
  const before = await snapshot(member);
  const denied = await call(member, "/onboarding-chat/messages", { id: randomUUID(), version: before.version, text: trainingText });
  assert.equal(denied.statusCode, 403);
  await grant(member); const c = await snapshot(member);
  await model(() => trainingReply, async sent => {
    const r = await call(member, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, text: trainingText });
    assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().ready, true, r.body); assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].brainRules, []);
    const saved = await call(member, "/onboarding-chat/actions", { id: randomUUID(), version: r.json().version, action: "profile", timezone: "Asia/Dubai" });
    assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().error, undefined, saved.body); assert.ok(saved.json().applied.profile);
    const records = await ctx.db.tenant({ userId: member.userId, tenantId: owner.tenantId, role: "subscriber" }, tx => tx.query("SELECT data FROM records WHERE kind='intake'"));
    assert.equal(records.length, 1); assert.equal(records[0].data.age, 28);
    assert.deepEqual(records[0].data.availableWeekdays, [1, 3, 5]);
    const again = await call(member, "/onboarding-chat/actions", { id: randomUUID(), version: saved.json().version, action: "profile", timezone: "Asia/Dubai" });
    assert.equal(again.json().error, undefined, again.body);
    const count = await ctx.db.tenant({ userId: member.userId, tenantId: owner.tenantId, role: "subscriber" }, tx => tx.query("SELECT count(*)::int AS n FROM records WHERE kind='intake'"));
    assert.equal(count[0].n, 1);
  });
  const forbidden = await call(member, "/onboarding-chat/actions", { id: randomUUID(), version: (await snapshot(member)).version, action: "compile" });
  assert.equal(forbidden.statusCode, 403);
});
test("private conversations are isolated from another tenant, members and team roles", async () => {
  const owner = await ctx.person({ role: "owner" }), stranger = await ctx.person({ role: "owner" });
  const member = await ctx.person({ role: "subscriber", tenantId: owner.tenantId }), staff = await ctx.person({ role: "staff", tenantId: owner.tenantId });
  await grant(member); const privateChat = await snapshot(member);
  assert.notEqual((await snapshot(stranger)).id, privateChat.id);
  assert.equal((await call(staff, "/onboarding-chat")).statusCode, 403);
  for (const person of [owner, stranger, staff]) {
    const rows = await ctx.db.tenant({ userId: person.userId, tenantId: person.tenantId, role: person === staff ? "staff" : "owner" }, tx => tx.query("SELECT id FROM records WHERE id=$1", [privateChat.id]));
    assert.equal(rows.length, 0);
  }
});
test("withdrawal during inference removes private messages and rejects the late reply", async () => {
  const owner = await ctx.person({ role: "owner" }), member = await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
  await grant(member); const c = await snapshot(member);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  await model(async () => { enter(); await held; return trainingReply; }, async sent => {
    const running = call(member, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, text: trainingText });
    await entered;
    try { const withdrawn = await call(member, "/privacy/consent", { type: "coaching", granted: false }); assert.equal(withdrawn.statusCode, 200, withdrawn.body); } finally { release(); }
    const result = await running;
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().permissions.coaching, false);
    assert.deepEqual(result.json().facts, {}); assert.ok(!JSON.stringify(result.json().messages).includes("Dumbbells")); assert.equal(sent.length, 1);
    await grant(member); const fresh = await snapshot(member); assert.deepEqual(fresh.facts, {});
  });
});

test("quick choices skip inference and update the current question", async () => {
  assert.equal(quickChatReply("daysPerWeek", "3 days a week")?.patch.daysPerWeek, 3);
  assert.equal(quickChatReply("daysPerWeek", "3 days a week but only during summer"), null);
  const owner = await ctx.person({ role: "owner" }), member = await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
  await grant(member); const c = await snapshot(member);
  await model(() => ({ reply: "Got it.", patch: { goal: "Build strength", experience: "beginner" }, evidence: { goal: "Build strength", experience: "beginner" } }), async sent => {
    const r = await call(member, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, text: "Build strength. I'm a beginner." });
    assert.equal(r.json().lastQuestion.field, "daysPerWeek", r.body);
    const quick = await call(member, "/onboarding-chat/messages", { id: randomUUID(), version: r.json().version, text: "3 days a week" });
    assert.equal(quick.json().facts.daysPerWeek, 3); assert.equal(sent.length, 1);
  });
});
test("explicit reply retry does not duplicate the transcript or teaching source", async () => {
  const owner = await ctx.person({ role: "owner" }), c = await snapshot(owner);
  const body = { id: randomUUID(), version: c.version, mode: "teach", text: "I only progress a load after all prescribed reps are comfortable." };
  let count = 0;
  await model(() => ++count === 1 ? "bad fixture" : { reply: "Understood.", patch: {}, evidence: {} }, async sent => {
    const failed = await call(owner, "/onboarding-chat/messages", body);
    assert.ok(failed.json().error);
    const retry = await call(owner, "/onboarding-chat/messages", { ...body, id: randomUUID(), version: failed.json().version, retryOf: body.id });
    assert.equal(retry.json().error, undefined, retry.body);
    assert.equal(retry.json().messages.filter((m: any) => m.from === "person").length, 1);
    assert.equal(retry.json().teachingIds.length, 1); assert.equal(sent.length, 2);
  });
});

test("reviewed trainer profile and offer save through the existing draft workflows", async () => {
  const owner = await ctx.person({ role: "owner" }), c = await snapshot(owner);
  const spec = specialties[0]!;
  const text = "I'm Alex in Dubai. I coach busy beginners. My specialty is " + spec.label + ". Strength coaching for busy beginners. I help beginners build confidence with simple, consistent strength sessions. My offer is Starter Strength, 300 AED monthly.";
  const patch = { publicName: "Alex", city: "Dubai", audience: "busy beginners", specialty: spec.id, headline: "Strength coaching for busy beginners", bio: "I help beginners build confidence with simple, consistent strength sessions.", name: "Starter Strength", priceAed: 300, billing: "monthly" };
  await model(() => ({ reply: "Got it.", patch, evidence: Object.fromEntries(Object.keys(patch).map(k => [k, text])) }), async () => {
    const r = await call(owner, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, text });
    assert.equal(r.json().ready, true, r.body);
    const profile = await call(owner, "/onboarding-chat/actions", { id: randomUUID(), version: r.json().version, action: "profile" });
    assert.equal(profile.json().error, undefined, profile.body); assert.ok(profile.json().applied.profile);
    const offer = await call(owner, "/onboarding-chat/actions", { id: randomUUID(), version: profile.json().version, action: "offer" });
    assert.equal(offer.json().error, undefined, offer.body); assert.ok(offer.json().applied.offer);
    const again = await call(owner, "/onboarding-chat/actions", { id: randomUUID(), version: offer.json().version, action: "offer" });
    assert.equal(again.json().error, undefined, again.body);
    const products = await ctx.db.tenant({ userId: owner.userId, tenantId: owner.tenantId, role: "owner" }, tx => tx.query("SELECT status,data FROM records WHERE kind='product'"));
    assert.equal(products.length, 1); assert.equal(products[0].status, "draft"); assert.equal(products[0].data.priceMinor, 30000);
  });
});

test("nutrition needs entitlement plus both permissions, then saves the real food profile", async () => {
  const owner = await ctx.person({ role: "owner" }), member = await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
  await ctx.db.tenant({ userId: owner.userId, tenantId: owner.tenantId, role: "owner" }, tx => tx.query("INSERT INTO complimentary_access(id,tenant_id,user_id,tier,reason,granted_by) VALUES($1,$2,$3,'workout_nutrition','Synthetic onboarding fixture',$4)", [randomUUID(), owner.tenantId, member.userId, owner.userId]));
  await grant(member); await grant(member, "nutrition");
  let c = await snapshot(member);
  assert.equal(c.permissions.nutritionIncluded, true); assert.equal(c.permissions.nutrition, false);
  const foodText = "I eat vegetarian food. No food allergies or other exclusions. Stove and oven. 20 minutes cooking, moderate budget. General meal planning.";
  const patch = { diet: "vegetarian", allergyStatus: "none_reported", allergens: [], exclusions: [], kitchenEquipment: ["stove", "oven"], cookingMinutes: 20, foodBudget: "moderate", nutritionScope: "general_wellness" };
  await model(input => input.conversation.at(-1).text === trainingText ? trainingReply : { reply: "Saved that.", patch, evidence: Object.fromEntries(Object.keys(patch).map(k => [k, foodText])) }, async sent => {
    const trainingResult = await call(member, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, text: trainingText });
    c = trainingResult.json();
    const ignoredFood = await call(member, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, text: foodText });
    c = ignoredFood.json(); assert.equal(c.facts.diet, undefined);
    assert.equal(sent.at(-1).nutritionIncluded, false);
    await grant(member, "nutrition_model");
    const food = await call(member, "/onboarding-chat/messages", { id: randomUUID(), version: c.version, text: foodText });
    assert.deepEqual(food.json().missing, [], food.body);
    const saved = await call(member, "/onboarding-chat/actions", { id: randomUUID(), version: food.json().version, action: "nutrition", timezone: "Asia/Dubai" });
    assert.equal(saved.json().error, undefined, saved.body); assert.ok(saved.json().applied.nutrition);
    const rows = await ctx.db.tenant({ userId: member.userId, tenantId: member.tenantId, role: "subscriber" }, tx => tx.query("SELECT data FROM records WHERE kind='nutrition_profile' AND status='current'"));
    assert.equal(rows.length, 1); assert.deepEqual(rows[0].data.profile.equipment, ["stove", "oven"]);
    assert.equal(rows[0].data.profile.allergyStatus, "none_reported");
  });
  await call(member, "/privacy/consent", { type: "nutrition_model", granted: false });
  const cleared = await snapshot(member);
  assert.equal(cleared.permissions.nutrition, false); assert.equal(cleared.facts.diet, undefined);
  assert.ok(!JSON.stringify(cleared.messages).includes("vegetarian"));
});

test("verified edge requests keep host and identity across the internal setup routes", async () => {
  const owner = await ctx.person({ role: "owner" }), secret = "synthetic-onboarding-proof-only-0000000000";
  await withEnv({ INTERNAL_PROXY_SECRET: secret }, async () => {
    const time = String(Date.now()), url = "/api/v1/onboarding-chat";
    const headers = { [HOST_HEADERS.host]: "localhost:3000", [HOST_HEADERS.time]: time, [HOST_HEADERS.clientIp]: "127.0.0.1", [HOST_HEADERS.signature]: signHostRequest("localhost:3000", "GET", url, time, secret, "127.0.0.1") };
    const valid = await ctx.call("/onboarding-chat", { cookie: owner.cookie, headers });
    assert.equal(valid.statusCode, 200, valid.body); assert.ok(valid.json().setup);
    const invalid = await ctx.call("/onboarding-chat", { cookie: owner.cookie, headers: { ...headers, [HOST_HEADERS.host]: "wrong.example.test" } });
    assert.equal(invalid.statusCode, 400);
  });
});

test("resume excludes previously compiled teaching and includes new practice corrections", async () => {
  const owner = await ctx.person({ role: "owner" }), a = { userId: owner.userId, tenantId: owner.tenantId, role: "owner" };
  let compiledId = "", correctionId = "";
  await ctx.db.tenant(a, async tx => {
    const source = await putRecord(tx, a, "interview", { origin: "onboarding_chat", question: "Progression", answer: "Wait for all reps", allowedUses: ["model_prompt", "trainer_specific_learning"] }, { status: "answered" });
    compiledId = source.id;
    await putRecord(tx, a, "rule", { title: "Progression", condition: "All reps complete", directive: "Review before increasing", compilationCoverage: { sources: [{ sourceId: source.id }] } }, { status: "draft" });
  });
  let c = await snapshot(owner); assert.ok(!c.teachingIds.includes(compiledId));
  await ctx.db.tenant(a, async tx => {
    const correction = await putRecord(tx, a, "interview", { origin: "quiz", source: "rule", verdict: "change", question: "What would you say?", answer: "Let's hold the load this week.", allowedUses: ["model_prompt", "trainer_specific_learning"] }, { status: "answered" });
    correctionId = correction.id;
  });
  c = await snapshot(owner); assert.ok(c.teachingIds.includes(correctionId));
  assert.ok(!c.compiledIds.includes(correctionId)); assert.equal(c.brain.suggestions.teaching, 1);
});
