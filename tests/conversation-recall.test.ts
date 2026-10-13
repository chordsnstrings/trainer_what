import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectConversationContext,
  conversationContextPolicy,
  conversationContextInstruction,
  type ConversationRow,
} from "../packages/domain/src/conversation-context.ts";
import {
  fidelityCaseSchema,
  fidelityConversation,
} from "../packages/domain/src/brain-fidelity.ts";

const now = Date.parse("2026-10-13T12:00:00Z"),
  day = 86400000;
const row = (
  id: string,
  text: string,
  age: number,
  author = "subscriber",
): ConversationRow => ({
  id,
  text,
  author,
  version: 1,
  sentAt: new Date(now - age * day).toISOString(),
});
const select = (rows: ConversationRow[], request: string, recall = true) =>
  selectConversationContext(rows, request, { now, recall });
const recalled = (result: ReturnType<typeof select>) =>
  result.context.recalled?.flatMap((e) => e.turns) ?? [];

test("recall selects whole relevant exchanges across English, Arabic and mixed messages", () => {
  const cases = [
    ["I can use dumbbells at home.", "Ask about dumbbell options."],
    [
      "Evenings are taken up by my commute.",
      "What did we discuss about the commute?",
    ],
    [
      "I prefer a quiet gym without loud music.",
      "Can you recall the music discussion?",
    ],
    ["I will be travelling in November.", "What about travelling again?"],
    ["أفضل التمرين في الصَّبَاح.", "تذكر الصباح؟"],
    ["السباحة أسهل قرب المنزل.", "ماذا عن السباحة؟"],
    ["أيام العمل أفضل عندي.", "كيف انظم ايام العمل؟"],
    ["أفضل dumbbells في المنزل.", "هل dumbbell متاح؟"],
  ];
  for (const [text, question] of cases) {
    const rows = [
      row("other", "Unrelated cycling preference.", 40),
      row("old", text, 20),
      row("reply", "Tell me if that changes.", 19.99, "trainer"),
      row("recent", "Welcome back.", 1, "trainer"),
    ];
    const result = select(rows, question);
    assert.deepEqual(
      recalled(result).map((t) => t.text),
      [text, "Tell me if that changes."],
      question,
    );
    assert.deepEqual(
      result.context.turns.map((t) => t.text),
      ["Welcome back."],
    );
    assert.deepEqual(
      result.source.map((r) => r.id),
      ["old", "reply", "recent"],
    );
    assert.ok(
      recalled(result).every(
        (t) => !Object.hasOwn(t, "id") && !Object.hasOwn(t, "version"),
      ),
    );
    assert.deepEqual(
      select([...rows].reverse(), question),
      result,
      "Input order cannot change selection",
    );
  }
});

test("absent, generic, unrelated or baseline queries do not invent recalled context", () => {
  const rows = [
    row("old", "Dumbbells are available at home.", 20),
    row("recent", "Welcome back.", 1, "trainer"),
  ];
  for (const question of [
    "",
    "Remember what I said before?",
    "تذكر ما قلت",
    "What about swimming?",
  ])
    assert.deepEqual(recalled(select(rows, question)), [], question);
  const baseline = select(rows, "Dumbbells?", false);
  assert.deepEqual(recalled(baseline), []);
  assert.deepEqual(
    baseline.source.map((r) => r.id),
    ["recent"],
  );
});

test("recall preserves a nearby correction, authorship and later contradictory recent context", () => {
  const rows = [
    row("old", "I use dumbbells at home.", 20),
    row("reply", "We can discuss that option.", 19.999, "digital_reviewed"),
    row(
      "correction",
      "Actually, that has changed. Do not use that option.",
      19.998,
    ),
    row("ack", "Understood. I will ask again.", 19.997, "trainer"),
    row("new", "I have no equipment at home now.", 1),
  ];
  const result = select(rows, "Dumbbells at home?");
  assert.deepEqual(
    result.source.map((r) => r.id),
    rows.map((r) => r.id),
  );
  assert.match(recalled(result)[2].text, /Do not use/);
  assert.equal(recalled(result)[1].author, "digital_reviewed");
  assert.match(
    conversationContextInstruction,
    /Newer corrections and current saved facts override older statements/,
  );
  assert.match(
    conversationContextInstruction,
    /Only the current request authorises an action/,
  );
});

test("older messages within a busy recent fortnight can be recalled without duplication", () => {
  const rows = [
    row("old", "Dumbbells are in the garage.", 5),
    row("reply", "We can revisit that.", 4.99, "trainer"),
    ...Array.from({ length: 12 }, (_, i) =>
      row(
        `new${i}`,
        "Unrelated routine check-in.",
        1 + i / 100,
        i % 2 ? "trainer" : "subscriber",
      ),
    ),
  ];
  const result = select(rows, "Dumbbells?");
  assert.equal(result.context.turns.length, 12);
  assert.equal(recalled(result).length, 2);
  assert.equal(
    new Set(result.source.map((r) => r.id)).size,
    result.source.length,
  );
});

test("recall excludes expired, future, invalid and unsupported-author rows", () => {
  const rows = [
    row("expired", "Dumbbells available.", 91),
    row("future", "Dumbbells available.", -1),
    row("system", "Dumbbells private.", 20, "system"),
    { ...row("invalid", "Dumbbells.", 20), sentAt: "invalid" },
    row("empty", "  ", 20),
    row("orphan", "Dumbbells were discussed.", 19, "trainer"),
  ];
  assert.deepEqual(select(rows, "Dumbbells?").source, []);
});

test("recall stays within candidate, excerpt, whole-turn and character limits", () => {
  const bounded = select(
    [
      row("out-of-candidates", "Dumbbells available.", 20),
      ...Array.from({ length: 200 }, (_, i) =>
        row(`noise-${i}`, "Unrelated conversation.", i / 100 + 1),
      ),
    ],
    "Dumbbells?",
  );
  assert.deepEqual(recalled(bounded), []);
  const groups = Array.from({ length: 10 }, (_, i) =>
    row(`match-${i}`, "Dumbbells available.", 20 + i * 3),
  );
  assert.equal(
    select(groups, "Dumbbells?").context.recalled!.length,
    conversationContextPolicy.maxRecallExcerpts,
  );
  const long = [
    row("long", "Dumbbells " + "x".repeat(3990), 20),
    row("negation", "Do not use them yet.", 19.99, "trainer"),
  ];
  assert.deepEqual(
    recalled(select(long, "Dumbbells?")),
    [],
    "Never cut off the qualifying reply to fit the cap",
  );
  const tooMany = [
    row("question", "Dumbbells?", 20),
    ...Array.from({ length: 6 }, (_, i) =>
      row(`reply-${i}`, "Keep the whole reply.", 19.99 - i / 100, "trainer"),
    ),
  ];
  assert.deepEqual(recalled(select(tooMany, "Dumbbells?")), []);
});

test("fictional comparisons use the production selector at a fixed time and never include the reference", () => {
  const c = fidelityCaseSchema.parse({
    title: "Equipment follow-up",
    fictional: true,
    expectHandover: false,
    history: [
      { author: "subscriber", text: "Dumbbells are at home." },
      { author: "trainer", text: "Tell me if that changes." },
    ],
    turns: [
      { author: "subscriber", text: "My week has changed." },
      { author: "trainer", text: "What is possible now?" },
    ],
    request: "What about dumbbells?",
    referenceReply: "PRIVATE_REFERENCE_REPLY",
    referenceReason: "PRIVATE_REFERENCE_REASON",
  });
  const context = fidelityConversation(
    c,
    new Date(now).toISOString(),
    "recall",
  );
  assert.equal(context.recalled![0].turns.length, 2);
  assert.equal(context.turns.length, 2);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_REFERENCE/);
  const baseline = fidelityConversation(
    c,
    new Date(now).toISOString(),
    "recent_only",
  );
  assert.deepEqual(baseline.turns, context.turns);
  assert.equal(baseline.recalled, undefined);
  assert.equal(
    fidelityCaseSchema.safeParse({ ...c, history: c.history.slice(0, 1) })
      .success,
    false,
  );
  assert.equal(
    fidelityCaseSchema.safeParse({ ...c, history: [...c.history].reverse() })
      .success,
    false,
  );
  assert.equal(
    fidelityCaseSchema.safeParse({
      ...c,
      history: Array.from({ length: 6 }, (_, i) => ({
        author: i % 2 ? "trainer" : "subscriber",
        text: "x".repeat(700),
      })),
    }).success,
    false,
  );
});
