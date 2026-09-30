import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createPromptRefs,
  promptRefsInstruction,
  type PromptRefPath,
} from "../packages/providers/src/prompt-refs.ts";
import * as providers from "../packages/providers/src/index.ts";
import { planDraftSchema } from "../packages/domain/src/brain-plans.ts";
import { nutritionWeekSchema } from "../packages/domain/src/nutrition.ts";
import { decisionSchema, ruleSchema } from "../packages/domain/src/index.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** A stable RFC 4122 v4 UUID per seed, so fixtures are deterministic. */
function id(seed: string) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// Realistic payloads, shaped like the app's model requests.

/** selectCoachAction: request, facts, examples, rules, actions. */
function coachingPayload() {
  const rules = [
    {
      id: id("rule:reschedule"),
      version: 3,
      data: {
        title: "Keep missed sessions inside the week",
        category: "schedule",
        condition: "The client cannot train on a planned day",
        directive:
          "Move the session to the next free day in the same week; never stack two heavy days.",
        reason: "Weekly volume matters more than the exact weekday.",
        allowedUses: ["model_prompt", "trainer_specific_learning"],
      },
    },
    {
      id: id("rule:progression"),
      version: 1,
      data: {
        title: "Add 2.5 kg after clean sets at RIR 2",
        category: "progression",
        condition: "All working sets completed at RIR 2 or more",
        directive: "Add 2.5 kg next session; at most 5% in one step.",
        reason: "Small steady increments.",
        allowedUses: ["model_prompt"],
      },
    },
  ];
  const actions = [
    {
      id: id("action:reschedule"),
      data: {
        key: "reschedule_within_week",
        title: "Move one session within the week",
        evidenceIds: [rules[0].id],
        response: "Moved to your next free day this week.",
      },
    },
    {
      id: id("action:progress"),
      data: {
        key: "progress_load",
        title: "Progress the load",
        evidenceIds: [rules[1].id],
        response: "Add 2.5 kg next time.",
      },
    },
  ];
  const examples = [
    {
      id: id("case:travel"),
      data: {
        category: "schedule",
        scenario: `Client travelling asks to move Thursday to Saturday (see rule ${rules[0].id}).`,
        recommendation: "Move it to Saturday, keep Sunday as rest.",
        reason: "Keeps weekly volume.",
        alternatives: "A hotel-gym dumbbell version.",
        changeWhen: "Travel longer than a week.",
        escalateWhen: "Any pain or illness.",
        allowedUses: ["model_prompt", "trainer_specific_learning"],
      },
    },
  ];
  const facts = {
    member: { id: id("member:1"), experience: "intermediate", daysPerWeek: 3 },
    plannedSessions: [
      {
        id: id("session:thu"),
        date: "2026-10-01",
        title: "Upper A",
        weekday: 4,
      },
      {
        id: id("session:sat"),
        date: "2026-10-03",
        title: "Lower B",
        weekday: 6,
      },
    ],
    lastWorkout: {
      id: id("workout:9"),
      completedAt: "2026-09-28T07:10:00.000Z",
      rir: 2,
    },
  };
  return {
    rules,
    actions,
    examples,
    payload: {
      request:
        "I'm travelling on Thursday, can I do Upper A on Friday instead?",
      facts,
      examples,
      rules,
      actions: actions.map((a) => ({ id: a.id, data: a.data })),
    },
  };
}
const coachingKinds = (c: ReturnType<typeof coachingPayload>) => [
  { prefix: "A", ids: c.actions.map((a) => a.id) },
  { prefix: "R", ids: c.rules.map((r) => r.id) },
  { prefix: "C", ids: c.examples.map((e) => e.id) },
];

/** generateTrainingPlan: profile, programme, bounds, twin, previous, material, startingLoads. */
function planPayload() {
  const rules = ["deload", "volume", "start", "hinge"].map((k) => ({
    id: id(`plan-rule:${k}`),
    data: {
      title: `Rule ${k}`,
      category: "progression",
      condition: `When ${k} applies`,
      directive: `Follow the ${k} method`,
      reason: "Trainer method",
    },
  }));
  const cases = [
    {
      id: id("plan-case:beginner"),
      data: {
        category: "program_build",
        scenario: "Beginner, 3 days",
        recommendation: "Full body A/B/A",
      },
    },
  ];
  const examples = [
    {
      id: id("plan-example:1"),
      data: {
        type: "edit",
        decision: "approved_with_edits",
        segment: { goal: "strength", experience: "beginner" },
        note: `Swapped the hinge per ${rules[3].id}`,
        diff: [
          {
            path: "sessions.0.exercises.2.name",
            from: "Deadlift",
            to: "Romanian deadlift",
          },
        ],
        plan: null,
      },
    },
  ];
  const templates = [
    {
      id: id("plan-template:fb3"),
      data: {
        title: "Full body 3x",
        goal: "strength",
        daysPerWeek: 3,
        weeks: 4,
        sessions: null,
        exercises: ["Back squat", "Bench press", "Barbell row"],
      },
    },
  ];
  return {
    rules,
    cases,
    examples,
    templates,
    payload: {
      task: "plan_generation",
      profile: {
        id: id("member:2"),
        goal: "strength",
        experience: "beginner",
        daysPerWeek: 3,
        equipment: ["barbell", "rack", "bench"],
      },
      programme: { days: 28, weeks: 4, startDate: "2026-10-05" },
      bounds: {
        maxWeeklyVolumeIncreasePct: 10,
        maxLoadJumpPct: 10,
        startLoadCapKg: 40,
      },
      twin: {
        adherence: 0.86,
        recentWorkouts: [
          { id: id("workout:21"), exercise: "Back squat", loadKg: 50, rir: 2 },
          { id: id("workout:22"), exercise: "Bench press", loadKg: 35, rir: 3 },
        ],
      },
      previous: {
        programId: id("program:old"),
        sessions: [
          {
            plannedSessionId: id("planned:1"),
            sessionKey: "A",
            date: "2026-09-28",
          },
        ],
      },
      material: {
        rules,
        cases,
        examples,
        templates,
        library: [
          {
            name: "Back squat",
            equipment: ["barbell", "rack"],
            alternatives: ["Goblet squat"],
            cue: "Brace, knees out",
          },
          {
            name: "Romanian deadlift",
            equipment: ["barbell"],
            alternatives: ["Dumbbell RDL"],
            cue: "Hinge at the hips",
          },
        ],
      },
      startingLoads: { "Back squat": 50, "Bench press": 35 },
    },
  };
}
const planPrefix = (path: PromptRefPath) =>
  path[0] === "material"
    ? (
        { rules: "R", cases: "C", examples: "E", templates: "T" } as Record<
          string,
          string
        >
      )[String(path[1])]
    : undefined;

/** nutritionModel("nutrition_week"): profile, policy, recipes with foods, cases. */
function nutritionPayload() {
  const recipes = ["oats", "chicken-rice", "salmon-potato"].map((k, i) => ({
    id: id(`recipe:${k}`),
    title: ["Overnight oats", "Chicken and rice", "Salmon and potatoes"][i],
    variants: [{ key: "standard", kcal: [480, 720, 690][i] }],
    ingredients: [
      { foodId: id(`food:${k}:1`), grams: 80 },
      { foodId: id(`food:${k}:2`), grams: 150 },
    ],
  }));
  const cases = ["high-protein", "no-fish-fridays", "batch-cook"].map((k) => ({
    id: id(`nutrition-case:${k}`),
    title: k,
    advice: `Coach advice for ${k}`,
  }));
  return {
    recipes,
    cases,
    payload: {
      task: "nutrition_week",
      promptVersion: "nutrition-cases-v2",
      input: {
        profile: {
          id: id("member:3"),
          goal: "fat_loss",
          targetKcal: 2400,
          allergies: [],
        },
        policy: {
          id: id("policy:1"),
          sourceIds: cases.map((c) => c.id),
          minKcal: 1500,
          maxKcal: 3200,
        },
        recipes,
        cases,
        // Recipes keyed by ID, as some requests group them.
        servingsByRecipe: Object.fromEntries(recipes.map((r) => [r.id, 1])),
        notes: `Client prefers ${recipes[0].id} for breakfast; see case ${cases[2].id}.`,
      },
    },
  };
}
const nutritionPrefix = (path: PromptRefPath) =>
  path.includes("ingredients")
    ? "F"
    : path.includes("recipes") || path.includes("servingsByRecipe")
      ? "M"
      : path.includes("cases") || path.includes("sourceIds")
        ? "C"
        : undefined;

/** compileTrainerRules: selected teaching sources. */
function compilationPayload() {
  return ["progression", "deload", "travel"].map((k) => ({
    id: id(`source:${k}`),
    title: `Teaching note: ${k}`,
    text: `When clients ${k}, I ... (trainer's own words, 2.5 kg steps, RIR 2).`,
  }));
}

// ---------------------------------------------------------------------------

test("encodes every UUID in keys, values and text, and leaves everything else alone", () => {
  const a = id("a"),
    b = id("b"),
    glued = `x${id("glued")}`;
  const refs = createPromptRefs({
    id: a,
    upper: a.toUpperCase(),
    [b]: {
      note: `Follow ${a} then ${b}.`,
      list: [b, "2026-09-29", "RIR 2", 42, true, null],
    },
    glued,
  });
  assert.deepEqual(refs.payload, {
    id: "ID1",
    upper: "ID1",
    ID2: {
      note: "Follow ID1 then ID2.",
      list: ["ID2", "2026-09-29", "RIR 2", 42, true, null],
    },
    glued, // glued to a letter: not an identifier, passed through and not flagged
  });
  assert.deepEqual(refs.entries(), [
    { ref: "ID1", id: a, prefix: "ID" },
    { ref: "ID2", id: b, prefix: "ID" },
  ]);
  assert.equal(refs.size, 2);
  assert.deepEqual(refs.decode(refs.payload).issues, []);
  // Every realistic payload leaves no full UUID for the model to miscopy.
  for (const { payload, options } of [
    {
      payload: coachingPayload().payload,
      options: { kinds: coachingKinds(coachingPayload()) },
    },
    { payload: planPayload().payload, options: { prefixAt: planPrefix } },
    {
      payload: nutritionPayload().payload,
      options: { prefixAt: nutritionPrefix },
    },
    { payload: compilationPayload(), options: { defaultPrefix: "S" } },
  ]) {
    const encoded = JSON.stringify(createPromptRefs(payload, options).payload);
    assert.doesNotMatch(encoded, UUID);
    assert.ok(encoded.length < JSON.stringify(payload).length);
  }
});

test("numbering is deterministic: listed kinds first in list order, then walk order, per prefix", () => {
  const c = coachingPayload();
  const first = createPromptRefs(c.payload, { kinds: coachingKinds(c) });
  const second = createPromptRefs(coachingPayload().payload, {
    kinds: coachingKinds(coachingPayload()),
  });
  assert.deepEqual(first.payload, second.payload);
  assert.deepEqual(first.entries(), second.entries());
  assert.deepEqual(
    first.entries().map((e) => e.ref),
    // Kinds in list order (actions, rules, cases), then facts in walk order.
    ["A1", "A2", "R1", "R2", "C1", "ID1", "ID2", "ID3", "ID4"],
  );
  assert.equal(first.refOf(c.actions[1].id), "A2");
  assert.equal(first.refOf(c.rules[0].id), "R1");
  assert.equal(first.refOf(c.payload.facts.member.id), "ID1");
  assert.equal(first.refOf(c.payload.facts.lastWorkout.id), "ID4");
  // The same UUID gets the same reference wherever it appears.
  const encoded = first.payload as any;
  assert.equal(encoded.actions[0].data.evidenceIds[0], "R1");
  assert.equal(encoded.rules[0].id, "R1");
  assert.equal(
    encoded.examples[0].data.scenario,
    "Client travelling asks to move Thursday to Saturday (see rule R1).",
  );

  // A listed ID that the payload does not contain gets no reference, so the
  // model cannot cite something it was not shown.
  const absent = id("absent-rule");
  const withAbsent = createPromptRefs(c.payload, {
    kinds: [{ prefix: "R", ids: [absent, ...c.rules.map((r) => r.id)] }],
  });
  assert.equal(withAbsent.refOf(absent), undefined);
  assert.equal(withAbsent.refOf(c.rules[0].id), "R1");
  assert.equal(withAbsent.resolve("R3"), undefined);

  // prefixAt sees where an identifier first appears.
  const p = planPayload();
  const seen: Array<[PromptRefPath, string]> = [];
  const plan = createPromptRefs(p.payload, {
    prefixAt: (path, uuid) => {
      seen.push([path, uuid]);
      return planPrefix(path);
    },
  });
  assert.deepEqual(seen[0], [["profile", "id"], p.payload.profile.id]);
  assert.equal(plan.refOf(p.rules[0].id), "R1");
  assert.equal(plan.refOf(p.rules[3].id), "R4");
  assert.equal(plan.refOf(p.cases[0].id), "C1");
  assert.equal(plan.refOf(p.examples[0].id), "E1");
  assert.equal(plan.refOf(p.templates[0].id), "T1");
  assert.equal(
    plan.refOf(p.payload.previous.sessions[0].plannedSessionId),
    "ID5",
  );
  assert.equal(
    (plan.payload as any).material.examples[0].data.note,
    "Swapped the hinge per R4",
  );
});

test("decodes single refs, lists, nested objects, keys and text; tolerates case and whitespace; accepts full UUIDs", () => {
  const c = coachingPayload();
  const refs = createPromptRefs(c.payload, { kinds: coachingKinds(c) });
  const [a1, a2] = c.actions.map((a) => a.id);
  const [r1, r2] = c.rules.map((r) => r.id);

  assert.equal(refs.resolve("A1"), a1);
  assert.equal(refs.resolve("  a2\n"), a2);
  assert.equal(refs.resolve(r1.toUpperCase()), r1);
  assert.equal(refs.resolve(` ${r2} `), r2);
  assert.equal(refs.resolve("A9"), undefined);
  assert.equal(refs.resolve(42), undefined);
  assert.deepEqual(refs.resolveAll(["R1", "r2", a1, "R7", 3]), {
    ids: [r1, r2, a1],
    unknown: ["R7", "3"],
  });

  assert.deepEqual(refs.decode("A1").value, a1);
  assert.deepEqual(refs.decode(["R1", "r2", a1.toUpperCase()]).value, [
    r1,
    r2,
    a1,
  ]);
  const nested = refs.decode({
    choice: { actionId: "A2", cited: [["R2"]] },
    byRule: { R1: "kept", [r2.toUpperCase()]: "also kept" },
    reason: "Picked A1 (see R1, and rule r2).",
  });
  assert.equal(nested.ok, true);
  assert.deepEqual(nested.value, {
    choice: { actionId: a2, cited: [[r2]] },
    byRule: { [r1]: "kept", [r2]: "also kept" },
    reason: `Picked ${a1} (see ${r1}, and rule ${r2}).`,
  });
});

test("reports unknown references and unknown or malformed UUIDs, never guessing", () => {
  const c = coachingPayload();
  const refs = createPromptRefs(c.payload, { kinds: coachingKinds(c) });
  const stranger = id("never-sent");
  const miscopy = c.rules[0].id.slice(0, -1); // one character dropped
  const out = refs.decode(
    {
      evidenceIds: ["R1", "R3", stranger, miscopy],
      reason: `Uses R1 and R4; also ${miscopy}. Vitamin B12 and RIR2 are not identifiers.`,
    },
    { idKeys: ["evidenceIds"] },
  );
  assert.equal(out.ok, false);
  assert.deepEqual(out.unknown, ["R3", stranger, miscopy, "R4"]);
  assert.deepEqual(out.issues, [
    { path: ["evidenceIds", 1], token: "R3", reason: "unknown_ref" },
    { path: ["evidenceIds", 2], token: stranger, reason: "unknown_uuid" },
    { path: ["evidenceIds", 3], token: miscopy, reason: "malformed_uuid" },
    { path: ["reason"], token: "R4", reason: "unknown_ref" },
    { path: ["reason"], token: miscopy, reason: "malformed_uuid" },
  ]);
  // Unknown tokens stay as written, so the app's own schema checks reject them too.
  assert.deepEqual(out.value.evidenceIds, [
    c.rules[0].id,
    "R3",
    stranger,
    miscopy,
  ]);
  assert.match(out.value.reason, /R4/);
});

test("idKeys fields resolve strictly: whitespace trimmed, null kept, anything else reported", () => {
  const c = coachingPayload();
  const refs = createPromptRefs(c.payload, { kinds: coachingKinds(c) });
  const out = refs.decode(
    [
      { actionId: " A1 ", evidenceIds: [" r1", "A1"] },
      { actionId: null, evidenceIds: [] },
      {
        actionId: "the reschedule action",
        evidenceIds: [1, { id: "R1" }, "R1."],
      },
      { actionId: 7, evidenceIds: "R2" },
    ],
    { idKeys: ["actionId", "evidenceIds"] },
  );
  assert.deepEqual(out.value[0], {
    actionId: c.actions[0].id,
    evidenceIds: [c.rules[0].id, c.actions[0].id],
  });
  assert.deepEqual(out.value[1], { actionId: null, evidenceIds: [] });
  assert.deepEqual(out.value[3].evidenceIds, c.rules[1].id);
  assert.deepEqual(
    out.issues.map((i) => [i.path.join("."), i.token, i.reason]),
    [
      ["2.actionId", "the reschedule action", "not_a_reference"],
      ["2.evidenceIds.0", "1", "not_a_reference"],
      ["2.evidenceIds.1", '{"id":"R1"}', "not_a_reference"],
      ["2.evidenceIds.2", "R1.", "not_a_reference"],
      ["3.actionId", "7", "not_a_reference"],
    ],
  );
  // Outside idKeys, surrounding whitespace in text is kept as written.
  assert.equal(refs.decode(" A1 ").value, ` ${c.actions[0].id} `);
});

test("never issues a reference that already appears as text, and leaves that text alone", () => {
  const rule = id("rule:x"),
    other = id("rule:y");
  const payload = {
    request: "My programme says R1 and r2 today; is that right?",
    rules: [{ id: rule }, { id: other }],
  };
  const refs = createPromptRefs(payload, {
    kinds: [{ prefix: "R", ids: [rule, other] }],
  });
  assert.equal(refs.refOf(rule), "R3");
  assert.equal(refs.refOf(other), "R4");
  assert.equal((refs.payload as any).request, payload.request);
  // Echoing the member's own "R1" in prose is not an unknown reference ...
  const prose = refs.decode({
    reason: "The R1 in your programme is session one; see R3.",
  });
  assert.equal(prose.ok, true);
  assert.equal(
    prose.value.reason,
    `The R1 in your programme is session one; see ${rule}.`,
  );
  // ... but it is never an identifier.
  assert.equal(refs.resolve("R1"), undefined);
  assert.deepEqual(
    refs.decode({ evidenceIds: ["R1"] }, { idKeys: ["evidenceIds"] }).unknown,
    ["R1"],
  );
});

test("inText: false keeps prose verbatim but still decodes whole identifier values", () => {
  const c = coachingPayload();
  const refs = createPromptRefs(c.payload, { kinds: coachingKinds(c) });
  const out = refs.decode(
    {
      message: "Moved per R1 — enjoy the trip!",
      actionId: "A1",
      nested: { recipeId: "R2" },
      bogus: "R9",
    },
    { inText: false },
  );
  assert.deepEqual(out.value, {
    message: "Moved per R1 — enjoy the trip!",
    actionId: c.actions[0].id,
    nested: { recipeId: c.rules[1].id },
    bogus: "R9",
  });
  assert.deepEqual(out.unknown, ["R9"]);
});

test("round-trips realistic coaching, plan, nutrition and compilation payloads exactly", () => {
  const cases: Array<[unknown, Parameters<typeof createPromptRefs>[1]]> = [
    [coachingPayload().payload, { kinds: coachingKinds(coachingPayload()) }],
    [planPayload().payload, { prefixAt: planPrefix }],
    [nutritionPayload().payload, { prefixAt: nutritionPrefix }],
    [compilationPayload(), { defaultPrefix: "S" }],
    [
      {
        text: "Arabic: التزم بالقاعدة " + id("ar") + " هذا الأسبوع",
        key: { [id("ar")]: "ثابت" },
      },
      {},
    ],
  ];
  for (const [payload, options] of cases) {
    const refs = createPromptRefs(payload, options);
    const back = refs.decode(refs.payload);
    assert.equal(back.ok, true);
    assert.deepEqual(back.value, json(payload));
  }
  const arabic = createPromptRefs({
    text: `التزم بالقاعدة ${id("ar")} هذا الأسبوع`,
  });
  assert.deepEqual(arabic.payload, { text: "التزم بالقاعدة ID1 هذا الأسبوع" });
  assert.equal(arabic.decode("اتبع ID1").value, `اتبع ${id("ar")}`);
});

test("payloads are encoded in their JSON form (what JSON.stringify sends)", () => {
  const a = id("date-case");
  const refs = createPromptRefs({
    at: new Date("2026-09-29T10:00:00.000Z"),
    missing: undefined,
    list: [undefined, a],
    custom: { toJSON: () => ({ ref: a }) },
  });
  assert.deepEqual(refs.payload, {
    at: "2026-09-29T10:00:00.000Z",
    list: [null, "ID1"],
    custom: { ref: "ID1" },
  });
  assert.equal(createPromptRefs(undefined).payload, undefined);
  assert.equal(createPromptRefs("no identifiers").size, 0);
});

test("a coach action selection answered in refs passes the app's evidence and action checks", () => {
  const c = coachingPayload();
  const refs = createPromptRefs(c.payload, { kinds: coachingKinds(c) });
  // selectCoachAction's schema and checks (packages/providers/src/coaching.ts).
  const selectionSchema = z
    .object({
      actionId: z.string().uuid().nullable(),
      requiresHumanReview: z.boolean(),
      reason: z.string().min(1).max(2000),
      evidenceIds: z.array(z.string().uuid()).max(30),
    })
    .strict();
  const reply = JSON.parse(
    '{"actionId":"A1","requiresHumanReview":false,"reason":"Travel on Thursday; A1 moves the session within the week per R1.","evidenceIds":["A1","R1"]}',
  );
  const decoded = refs.decode(reply, { idKeys: ["actionId", "evidenceIds"] });
  assert.equal(decoded.ok, true);
  const selection = selectionSchema.parse(decoded.value);
  const evidence = new Set(
    [...c.actions, ...c.examples, ...c.rules].map((e) => e.id),
  );
  assert.ok(selection.evidenceIds.every((e) => evidence.has(e)));
  assert.equal(selection.actionId, c.actions[0].id);

  // The draft path (modelDecision) validates with decisionSchema.
  const draft = refs.decode(
    {
      type: "schedule",
      message: "Friday works; enjoy the trip.",
      reason: "Per R1.",
      evidenceIds: ["R1", "C1"],
      requiresHumanReview: false,
    },
    { idKeys: ["evidenceIds"] },
  );
  assert.deepEqual(decisionSchema.parse(draft.value).evidenceIds, [
    c.rules[0].id,
    c.examples[0].id,
  ]);
});

test("a plan draft answered in refs parses with planDraftSchema and cites only retrieved material", () => {
  const p = planPayload();
  const refs = createPromptRefs(p.payload, { prefixAt: planPrefix });
  const exercise = (name: string, loadKg: number) => ({
    name,
    sets: 3,
    reps: 8,
    loadKg,
    rir: 3,
    restSeconds: 120,
    cue: "Brace",
    alternatives: [],
  });
  const reply = {
    title: "Foundations: 3-day full body",
    summary: "Full body A/B/A following R1 (deload) and T1.",
    sessions: [
      {
        key: "A",
        label: "Full body A",
        weekday: 1,
        exercises: [exercise("Back squat", 50)],
      },
      {
        key: "B",
        label: "Full body B",
        weekday: 3,
        exercises: [exercise("Romanian deadlift", 40)],
      },
    ],
    weeks: [1, 2, 3, 4].map((week) => ({
      week,
      focus: week === 4 ? "Deload" : "Build",
      volumeFactor: week === 4 ? 0.6 : 1,
      loadFactor: 1,
      rirDelta: 0,
      deload: week === 4,
    })),
    selfConfidence: 0.8,
    uncertainties: [],
    evidenceIds: ["R1", "r4", "C1", "E1", "T1"],
  };
  const decoded = refs.decode(reply, { idKeys: ["evidenceIds"] });
  assert.equal(decoded.ok, true);
  const draft = planDraftSchema.parse(decoded.value);
  const retrieved = new Set(
    [...p.rules, ...p.cases, ...p.examples, ...p.templates].map((r) => r.id),
  );
  assert.deepEqual(draft.evidenceIds, [
    p.rules[0].id,
    p.rules[3].id,
    p.cases[0].id,
    p.examples[0].id,
    p.templates[0].id,
  ]);
  assert.ok(draft.evidenceIds.every((e) => retrieved.has(e)));
  assert.equal(
    draft.summary,
    `Full body A/B/A following ${p.rules[0].id} (deload) and ${p.templates[0].id}.`,
  );
});

test("a meal week answered in refs parses with nutritionWeekSchema", () => {
  const n = nutritionPayload();
  const refs = createPromptRefs(n.payload, { prefixAt: nutritionPrefix });
  assert.deepEqual(
    refs.entries().map((e) => e.ref),
    [
      "ID1",
      "ID2",
      "C1",
      "C2",
      "C3",
      "M1",
      "F1",
      "F2",
      "M2",
      "F3",
      "F4",
      "M3",
      "F5",
      "F6",
    ],
  );
  const reply = {
    days: [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
      offset,
      meals: [
        {
          slot: "breakfast",
          recipeId: "M1",
          variantKey: "standard",
          servings: 1,
          batchKey: null,
        },
        {
          slot: "lunch",
          recipeId: "M2",
          variantKey: "standard",
          servings: 1.25,
          batchKey: "M2-batch",
        },
        {
          slot: "dinner",
          recipeId: offset === 4 ? "M2" : "M3",
          variantKey: "standard",
          servings: 1,
          batchKey: null,
        },
      ],
    })),
    caseIds: ["C1", "C2", "C3"],
    explanation:
      "High protein (C1), no fish on Friday (C2), lunches batch-cooked (C3).",
  };
  const decoded = refs.decode(reply, { idKeys: ["recipeId", "caseIds"] });
  assert.equal(decoded.ok, true);
  const week = nutritionWeekSchema.parse(decoded.value);
  assert.equal(week.days[0].meals[0].recipeId, n.recipes[0].id);
  assert.equal(week.days[4].meals[2].recipeId, n.recipes[1].id);
  assert.deepEqual(
    week.caseIds,
    n.cases.map((x) => x.id),
  );
  assert.equal(week.days[0].meals[1].batchKey, `${n.recipes[1].id}-batch`);
});

test("rules compiled in refs parse with ruleSchema and cite only the selected sources", () => {
  const sources = compilationPayload();
  const refs = createPromptRefs(sources, { defaultPrefix: "S" });
  const reply = {
    rules: [
      {
        title: "Add 2.5 kg after clean sets",
        category: "progression",
        condition: "All sets at RIR 2",
        directive: "Add 2.5 kg",
        reason: "S1",
        sourceIds: ["S1"],
      },
      {
        title: "Deload every fourth week",
        category: "recovery",
        condition: "Week 4",
        directive: "Cut sets by 40%",
        reason: "S2",
        sourceIds: ["S2", "S3"],
      },
    ],
    conflicts: [
      { description: "Travel week vs deload week", sourceIds: ["S2", "S3"] },
    ],
  };
  const decoded = refs.decode(reply, { idKeys: ["sourceIds"] });
  assert.equal(decoded.ok, true);
  const allowed = new Set(sources.map((s) => s.id));
  for (const rule of decoded.value.rules) {
    const parsed = ruleSchema.parse(rule);
    assert.ok(parsed.sourceIds.every((s) => allowed.has(s)));
  }
  assert.equal(decoded.value.rules[0].reason, sources[0].id);
});

// ---------------------------------------------------------------------------
// The model trial (September 2026): every miscopied ID, with the real ID it
// stood for and the output field it was in. Malformed copies failed schema
// checks; well-formed copies one character off failed evidence checks.

const trialMiscopies = [
  {
    scenario: "T1S03/meal_week",
    field: ["caseIds", 7],
    real: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f5",
    model: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f",
  },
  {
    scenario: "T1S06/meal_week",
    field: ["caseIds", 7],
    real: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f5",
    model: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f",
  },
  {
    scenario: "T1S05/meal_week",
    field: ["caseIds", 0],
    real: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f5",
    model: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f",
  },
  {
    scenario: "T1/nutrition_eval",
    field: ["decisions", 1, "rationaleEvidence", "caseId"],
    real: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f5",
    model: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f",
  },
  {
    scenario: "T1/nutrition_policy",
    field: ["policy", "sourceIds", 7],
    real: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f5",
    model: "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f",
  },
  {
    scenario: "T1S04/chat4",
    field: ["evidenceIds", 1],
    real: "1317a42e-a67c-498d-93ae-9473509d5baf",
    model: "1317a42e-a67c-498d-93ae-947350d5baf",
  },
  {
    scenario: "T1S07/chat1",
    field: ["evidenceIds", 1],
    real: "7466306a-b947-4365-84d6-2c29e8afd9c6",
    model: "7466306a-b947-4365-84d6-2c29e8afd9c",
  },
  {
    scenario: "T1S07/chat2",
    field: ["evidenceIds", 1],
    real: "d49ead45-c6e7-4b7c-b8f4-9888d6ef5e4a",
    model: "d49ead45-c6e7-4b7c-b8f4-9888d6ef5e4",
  },
  {
    scenario: "T2S06/plan",
    field: ["evidenceIds", 2],
    real: "03bd805e-116a-407f-b914-b18902927ffb",
    model: "03bd05e-116a-407f-b914-b18902927ffb",
  },
  {
    scenario: "T3S03/plan",
    field: ["evidenceIds", 5],
    real: "df92c0e3-358b-4dde-9ce0-6535a0852d43",
    model: "df92c0e35-858b-4dde-9ce0-6535a0852d43",
  },
  {
    scenario: "T1S07/adapt",
    field: ["evidenceIds", 0],
    real: "2432edf0-d62c-4eaf-91c5-f4aaf8f58d39",
    model: "2432edf0-d62c-4eaf-91c5-f4aaf8d39",
  },
] as const;
const trialNearMisses = [
  {
    scenario: "T2S02/plan",
    field: ["evidenceIds", 4],
    real: "3711bfdf-6248-4059-98e3-ea5557adb382",
    model: "3711bfdf-6248-4059-98e3-ea5557adb38b",
  },
  {
    scenario: "T2S05/chat4",
    field: ["evidenceIds", 0],
    real: "67f2a2c3-293a-4bc4-8ada-4b94dfbbe228",
    model: "67f2a2c2-293a-4bc4-8ada-4b94dfbbe228",
  },
  {
    scenario: "T1S03/chat4",
    field: ["evidenceIds", 2],
    real: "98e0b662-72a0-4e96-a2e2-1a8648139d91",
    model: "98e0b662-72a0-4e96-a2e5-1a8648139d91",
  },
] as const;

/** An output object with `value` at `field`, padding earlier list slots with other valid refs. */
function answerAt(
  field: readonly (string | number)[],
  value: string,
  filler: string,
) {
  const build = (i: number): unknown => {
    if (i === field.length) return value;
    const key = field[i];
    if (typeof key === "number")
      return [...Array(key).fill(filler), build(i + 1)];
    return { [key]: build(i + 1) };
  };
  return build(0) as Record<string, unknown>;
}
/** The property that holds the identifier: the last name in the path. */
function idKeyOf(field: readonly (string | number)[]) {
  return field.filter((k): k is string => typeof k === "string").at(-1)!;
}
function get(value: any, field: readonly (string | number)[]) {
  return field.reduce((v, k) => v?.[k], value);
}

test("trial regression: the real ID is sent as a short reference that decodes back exactly", () => {
  for (const t of [...trialMiscopies, ...trialNearMisses]) {
    const neighbour = id(`${t.scenario}:neighbour`);
    // The trial ID sits among other evidence, as in the app's requests.
    const refs = createPromptRefs(
      {
        evidence: [
          { id: neighbour, data: { title: "Another rule" } },
          { id: t.real, data: { title: "The rule the model cited" } },
        ],
      },
      { kinds: [{ prefix: "R", ids: [neighbour, t.real] }] },
    );
    assert.ok(!JSON.stringify(refs.payload).includes(t.real), t.scenario);
    assert.equal(refs.refOf(t.real), "R2", t.scenario);
    const idKeys = [idKeyOf(t.field)];
    const right = refs.decode(answerAt(t.field, "R2", "R1"), { idKeys });
    assert.equal(right.ok, true, t.scenario);
    assert.equal(get(right.value, t.field), t.real, t.scenario);
    // A model that still writes the full ID (any case) is accepted.
    const full = refs.decode(answerAt(t.field, t.real.toUpperCase(), "R1"), {
      idKeys,
    });
    assert.equal(get(full.value, t.field), t.real, t.scenario);
  }
});

test("trial regression: every miscopied ID is reported and never matched to the nearest real ID", () => {
  for (const t of trialMiscopies) {
    const refs = createPromptRefs(
      { evidence: [{ id: t.real }] },
      { kinds: [{ prefix: "R", ids: [t.real] }] },
    );
    const idKeys = [idKeyOf(t.field)];
    const out = refs.decode(answerAt(t.field, t.model, "R1"), { idKeys });
    assert.equal(out.ok, false, t.scenario);
    assert.deepEqual(out.unknown, [t.model], t.scenario);
    assert.deepEqual(
      out.issues,
      [{ path: [...t.field], token: t.model, reason: "malformed_uuid" }],
      t.scenario,
    );
    assert.equal(get(out.value, t.field), t.model, t.scenario);
    assert.equal(refs.resolve(t.model), undefined, t.scenario);
    // The same miscopy inside prose is caught too.
    const prose = refs.decode({ reason: `Following ${t.model}.` });
    assert.deepEqual(
      prose.issues,
      [{ path: ["reason"], token: t.model, reason: "malformed_uuid" }],
      t.scenario,
    );
  }
  for (const t of trialNearMisses) {
    const refs = createPromptRefs(
      { evidence: [{ id: t.real }] },
      { kinds: [{ prefix: "R", ids: [t.real] }] },
    );
    const out = refs.decode(answerAt(t.field, t.model, "R1"), {
      idKeys: ["evidenceIds"],
    });
    assert.equal(out.ok, false, t.scenario);
    assert.deepEqual(
      out.issues,
      [{ path: [...t.field], token: t.model, reason: "unknown_uuid" }],
      t.scenario,
    );
    assert.equal(get(out.value, t.field), t.model, t.scenario);
  }
});

test("trial regression: a meal week whose case list held the miscopy is rejected, the ref version accepted", () => {
  const n = nutritionPayload();
  const real = "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f5";
  const payload = {
    ...n.payload,
    input: {
      ...n.payload.input,
      cases: [
        ...n.cases,
        { id: real, title: "batch", advice: "Cook twice a week" },
      ],
    },
  };
  const refs = createPromptRefs(payload, { prefixAt: nutritionPrefix });
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
    offset,
    meals: [
      {
        slot: "breakfast",
        recipeId: "M1",
        variantKey: "standard",
        servings: 1,
        batchKey: null,
      },
    ],
  }));
  const ref = refs.refOf(real)!;
  assert.equal(ref, "C4");
  const good = refs.decode(
    { days, caseIds: ["C1", ref], explanation: "Batch cooking per C4." },
    { idKeys: ["recipeId", "caseIds"] },
  );
  assert.equal(good.ok, true);
  assert.deepEqual(nutritionWeekSchema.parse(good.value).caseIds, [
    n.cases[0].id,
    real,
  ]);
  const bad = refs.decode(
    {
      days,
      caseIds: ["C1", "14124d78-4f5f-4f1d-a753-bcf3a6dcb9f"],
      explanation: "Batch cooking.",
    },
    { idKeys: ["recipeId", "caseIds"] },
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unknown, ["14124d78-4f5f-4f1d-a753-bcf3a6dcb9f"]);
  assert.equal(nutritionWeekSchema.safeParse(bad.value).success, false);
});

// ---------------------------------------------------------------------------

test("rejects invalid options before anything is encoded", () => {
  const a = id("opt");
  assert.throws(
    () => createPromptRefs({ a }, { defaultPrefix: "r" }),
    TypeError,
  );
  assert.throws(
    () => createPromptRefs({ a }, { defaultPrefix: "RULES" }),
    TypeError,
  );
  assert.throws(
    () => createPromptRefs({ a }, { kinds: [{ prefix: "R1", ids: [a] }] }),
    TypeError,
  );
  assert.throws(
    () =>
      createPromptRefs(
        { a },
        { kinds: [{ prefix: "R", ids: ["not-a-uuid"] }] },
      ),
    TypeError,
  );
  assert.throws(
    () =>
      createPromptRefs(
        { a },
        {
          kinds: [
            { prefix: "R", ids: [a] },
            { prefix: "A", ids: [a.toUpperCase()] },
          ],
        },
      ),
    /listed under both R and A/,
  );
  assert.throws(
    () => createPromptRefs({ a }, { prefixAt: () => "x" }),
    TypeError,
  );
  // Listing the same ID twice under one prefix is harmless.
  assert.equal(
    createPromptRefs(
      { a },
      {
        kinds: [
          { prefix: "R", ids: [a, a] },
          { prefix: "R", ids: [a] },
        ],
      },
    ).refOf(a),
    "R1",
  );
});

test("refuses a payload whose references could not be decoded back unambiguously", () => {
  const a = id("sandwich");
  // A hex-letter prefix inside a longer hex-dash run would read as a damaged
  // UUID on the way back, so nothing is sent.
  const sandwich = { note: `deadbeef-cafe-${a}-babe-0123456789abcdef` };
  assert.throws(
    () => createPromptRefs(sandwich, { kinds: [{ prefix: "A", ids: [a] }] }),
    (e: any) => e.code === "PROMPT_REFS_UNSAFE" && e.statusCode === 409,
  );
  const safe = createPromptRefs(sandwich, {
    kinds: [{ prefix: "R", ids: [a] }],
  });
  assert.deepEqual(safe.payload, {
    note: "deadbeef-cafe-R1-babe-0123456789abcdef",
  });
  assert.deepEqual(safe.decode(safe.payload).value, sandwich);
  // Two keys naming one identifier in different letter case would merge.
  assert.throws(
    () => createPromptRefs({ [a]: "first", [a.toUpperCase()]: "second" }),
    (e: any) => e.code === "PROMPT_REFS_UNSAFE",
  );
  // One identifier spelled in two cases (even after a line break) is one reference.
  const spelled = createPromptRefs({
    id: a,
    note: `Rule:\n${a.toUpperCase()}`,
  });
  assert.deepEqual(spelled.payload, { id: "ID1", note: "Rule:\nID1" });
  assert.deepEqual(spelled.decode(spelled.payload).value, {
    id: a,
    note: `Rule:\n${a}`,
  });
});

test("random payloads round-trip exactly or are refused; nothing is silently changed", () => {
  let seed = 20260929;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const pick = <T>(xs: readonly T[]) => xs[rand(xs.length)];
  const pool = Array.from({ length: 6 }, (_, i) => id(`pool:${i}`));
  const words = [
    () => pick(pool),
    () => pick(pool).toUpperCase(),
    () => `x${pick(pool)}`, // glued: not an identifier
    () => pick(pool).slice(0, -1), // a damaged copy already in the input
    () => pick(["R1", "r2", "ID1", "M3", "B12", "C1", "RIR2", "3x10", "A-1"]),
    () =>
      pick([
        "2026-09-29",
        "12:30",
        "2.5kg",
        "—",
        "التزم",
        "بالقاعدة",
        "?",
        "(",
        ")",
        ",",
      ]),
    () => pick(["back squat", "rest day", "Upper A", "كتلة"]),
  ];
  const sentence = () =>
    Array.from({ length: 1 + rand(6) }, () => pick(words)()).join(
      pick([" ", "", "-", "/", "\n", ", "]),
    );
  const value = (depth: number): unknown => {
    const r = rand(depth > 2 ? 3 : 6);
    if (r === 0) return sentence();
    if (r === 1) return pick([1, 2.5, null, true, false]);
    if (r === 2) return pick(pool);
    if (r === 3) return Array.from({ length: rand(4) }, () => value(depth + 1));
    return Object.fromEntries(
      Array.from({ length: 1 + rand(4) }, (_, i) => [
        rand(3) === 0 ? pick(pool) : `k${i}`,
        value(depth + 1),
      ]),
    );
  };
  const uuidAlone =
    /(?<![0-9A-Za-z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z])/i;
  const strings = (v: unknown): string[] =>
    typeof v === "string"
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(strings)
        : v && typeof v === "object"
          ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)])
          : [];
  let refused = 0;
  for (let i = 0; i < 400; i++) {
    const payload = value(0);
    // Non-hex prefixes: nothing in these payloads can make a reference ambiguous.
    const refs = createPromptRefs(payload, {
      kinds: [{ prefix: "R", ids: pool.slice(0, 3) }],
      defaultPrefix: "ID",
    });
    assert.ok(
      !strings(refs.payload).some((s) => uuidAlone.test(s)),
      `case ${i}`,
    );
    const back = refs.decode(refs.payload);
    assert.equal(back.ok, true, `case ${i}`);
    const lower = (v: unknown): string =>
      JSON.stringify(v, (_k, x) =>
        typeof x === "string"
          ? x.replace(new RegExp(uuidAlone, "gi"), (m) => m.toLowerCase())
          : x,
      );
    assert.equal(lower(back.value), lower(json(payload)), `case ${i}`);
    // A hex-letter prefix may be refused, but is never silently wrong.
    try {
      const hex = createPromptRefs(payload, {
        kinds: [{ prefix: "C", ids: pool }],
      });
      assert.equal(
        lower(hex.decode(hex.payload).value),
        lower(json(payload)),
        `case ${i}`,
      );
    } catch (e: any) {
      assert.equal(e.code, "PROMPT_REFS_UNSAFE", `case ${i}`);
      refused++;
    }
  }
  assert.ok(refused < 40, `refused ${refused} of 400`);
  process.stdout.write(`# hex-prefix payloads refused: ${refused} of 400\n`);
});

test("decoding is prototype-safe and reports keys that collide", () => {
  const a = id("proto");
  const refs = createPromptRefs({ [a]: 1 });
  const out = refs.decode(
    JSON.parse(`{"__proto__": {"polluted": true}, "ID1": 1, "${a}": 2}`),
  );
  assert.equal(({} as any).polluted, undefined);
  assert.equal(Object.getPrototypeOf(out.value), Object.prototype);
  assert.deepEqual(Object.keys(out.value), ["__proto__", a]);
  assert.equal((out.value as any)[a], 1);
  assert.deepEqual(out.issues, [
    { path: [a], token: a, reason: "duplicate_key" },
  ]);
  assert.deepEqual(out.unknown, []);
  assert.equal(out.ok, false);
});

test("the package index re-exports the helper and the prompt sentence names the rule", () => {
  assert.equal(providers.createPromptRefs, createPromptRefs);
  assert.match(promptRefsInstruction, /exactly as written/);
  assert.match(promptRefsInstruction, /Never invent/);
});
