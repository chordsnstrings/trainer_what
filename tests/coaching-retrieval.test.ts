import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  coachingRetrievalPolicy,
  retrieveCoachingTeaching,
} from "../packages/providers/src/coaching-retrieval.ts";
import {
  coachingModelPin,
  selectCoachAction,
} from "../packages/providers/src/coaching.ts";

const tenantId = randomUUID();
function example(scenario: string, data: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenant_id: tenantId,
    kind: "coaching_teaching",
    status: "confirmed",
    version: 1,
    data: {
      category: "message",
      scenario,
      recommendation: "Use the approved guidance for this situation.",
      reason: "Maintain the trainer's intended constraints.",
      alternatives: "Discuss a suitable alternative with the trainer.",
      changeWhen: "Review any changes in the client's circumstances.",
      escalateWhen: "Request personal review for safety concerns.",
      allowedUses: ["model_prompt", "trainer_specific_learning"],
      ...data,
    },
  };
}
function input(examples: any[], extra: Record<string, unknown> = {}) {
  return {
    tenantId,
    request: "How can I manage a squat plateau?",
    facts: { profile: { experience: "intermediate", equipment: "Barbell" } },
    actions: [{ data: { type: "message" } }],
    examples,
    ...extra,
  };
}
test("relevance chooses an older matching case over the last six and is stable across storage order", () => {
  const relevant = example(
      "A barbell squat plateau despite completed repetitions",
    ),
    unrelated = Array.from({ length: 9 }, () =>
      example("A holiday reminder for a walking club"),
    );
  const cases = [relevant, ...unrelated],
    result = retrieveCoachingTeaching(input(cases));
  assert.deepEqual(
    result.examples.map((e) => e.id),
    [relevant.id],
  );
  assert.deepEqual(
    retrieveCoachingTeaching(input([...cases].reverse())),
    result,
  );
  const changed = structuredClone(cases);
  changed.at(-1)!.data.reason = "A changed approved teaching condition";
  assert.notEqual(
    retrieveCoachingTeaching(input(changed)).trace.materialDigest,
    result.trace.materialDigest,
  );
});
test("verified factual context distinguishes otherwise similar relevant cases", () => {
  const dumbbells = example("Choosing a suitable exercise with dumbbells"),
    kettlebells = example("Choosing a suitable exercise with kettlebells");
  const query = (equipment: string) =>
    retrieveCoachingTeaching(
      input([dumbbells, kettlebells], {
        request: "Help with choosing a suitable exercise",
        facts: { profile: { equipment } },
      }),
    );
  assert.equal(query("dumbbells").examples[0].id, dumbbells.id);
  assert.equal(query("kettlebells").examples[0].id, kettlebells.id);
});
test("only current tenant-approved teaching with learning rights is indexed; private and held-out records cannot enter prompts", () => {
  const approved = example("A squat plateau with a steady training schedule", {
    outcomeContext:
      "After reducing fatigue, the next observed session met the existing target.",
    rawOutcomeNote: "PRIVATE_RAW_OUTCOME",
    sourceReferences: [{ privateClientName: "PRIVATE_CLIENT" }],
  });
  const foreign = {
      ...example(approved.data.scenario),
      tenant_id: randomUUID(),
    },
    draft = { ...example(approved.data.scenario), status: "draft" },
    archived = { ...example(approved.data.scenario), status: "archived" },
    heldOut = {
      ...example(approved.data.scenario),
      kind: "coaching_scenario",
      status: "held_out",
    },
    outcome = {
      ...example(approved.data.scenario),
      kind: "coaching_feedback_outcome",
      data: { ...approved.data, note: "PRIVATE_RAW_OUTCOME" },
    },
    denied = example(approved.data.scenario, { allowedUses: ["render"] }),
    noLearningRights = example(approved.data.scenario, {
      allowedUses: ["model_prompt"],
    }),
    category = example(approved.data.scenario, { category: "schedule" });
  const result = retrieveCoachingTeaching(
    input([
      approved,
      foreign,
      draft,
      archived,
      heldOut,
      outcome,
      denied,
      noLearningRights,
      category,
    ]),
  );
  assert.deepEqual(
    result.examples.map((e) => e.id),
    [approved.id],
  );
  const content = JSON.stringify(result.examples);
  assert.match(content, /next observed session/);
  assert.doesNotMatch(content, /PRIVATE_|sourceReferences|rawOutcomeNote/);
  assert.deepEqual(retrieveCoachingTeaching(input([outcome])).examples, []);
});
test("retrieval caps candidates, full examples and serialized context without arbitrary padding", () => {
  const cases = Array.from({ length: 20 }, () =>
    example("A squat plateau needs review"),
  );
  assert.equal(retrieveCoachingTeaching(input(cases)).examples.length, 6);
  const verbose = cases.map((e) => ({
    ...e,
    data: {
      ...e.data,
      scenario: "squat plateau " + "x".repeat(2980),
      recommendation: "x".repeat(3000),
      reason: "x".repeat(3000),
      alternatives: "x".repeat(2000),
      changeWhen: "x".repeat(2000),
      escalateWhen: "x".repeat(2000),
      outcomeContext: "x".repeat(2000),
    },
  }));
  const retrieved = retrieveCoachingTeaching(input(verbose));
  assert.equal(retrieved.examples.length, 1);
  assert.equal(
    retrieved.examples[0].data.scenario.length,
    verbose[0].data.scenario.length,
  );
  assert.ok(
    retrieved.trace.characters <= coachingRetrievalPolicy.maxTotalChars,
  );
  assert.equal(
    retrieveCoachingTeaching(input(cases, { request: "Astronomy", facts: {} }))
      .examples.length,
    0,
  );
  assert.throws(
    () =>
      retrieveCoachingTeaching(
        input(Array.from({ length: 101 }, () => cases[0])),
      ),
    /Too many/,
  );
});
test("the model receives only retrieved reviewed text and cannot cite omitted evidence", async () => {
  const config = {
      MODEL_BASE_URL: "https://coaching-retrieval-fixture.invalid/v1",
      MODEL_API_KEY: "fixture",
      MODEL_NAME: "retrieval-fixture",
    },
    original = Object.fromEntries(
      Object.keys(config).map((key) => [key, process.env[key]]),
    ),
    fetch = globalThis.fetch;
  const approved = example("A squat plateau despite ordinary recovery", {
      outcomeContext:
        "A later completed session met the existing repetition target.",
    }),
    unrelated = example("Routine reminders for a walking club"),
    raw = {
      ...example(approved.data.scenario),
      kind: "coaching_feedback_outcome",
      data: { ...approved.data, note: "PRIVATE_RAW_OUTCOME" },
    },
    ruleId = randomUUID(),
    actionId = randomUUID();
  let prompt: any,
    citeOmitted = false,
    reservations = 0;
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    prompt = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    return Response.json({
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              actionId,
              requiresHumanReview: false,
              reason: "The reviewed action is appropriate",
              evidenceIds: [
                actionId,
                ruleId,
                citeOmitted ? unrelated.id : approved.id,
              ],
            }),
          },
        },
      ],
    });
  };
  try {
    const data = {
        ...input([approved, unrelated, raw]),
        actions: [
          {
            id: actionId,
            data: {
              type: "message",
              evidenceIds: [ruleId],
              allowedUses: ["model_prompt"],
            },
          },
        ],
        rules: [
          {
            id: ruleId,
            data: {
              directive: "Follow the approved boundary",
              allowedUses: ["model_prompt"],
            },
          },
        ],
      },
      accounting = {
        reserve: async () => {
          reservations++;
        },
        record: async () => {},
      };
    const result = await selectCoachAction(data, accounting);
    assert.deepEqual(
      prompt.examples.map((e: any) => e.id),
      [approved.id],
    );
    assert.doesNotMatch(
      JSON.stringify(prompt),
      /PRIVATE_RAW_OUTCOME|coaching_feedback_outcome/,
    );
    assert.equal(result.retrieval.examples[0].id, approved.id);
    assert.deepEqual(coachingModelPin().retrieval, coachingRetrievalPolicy);
    citeOmitted = true;
    await assert.rejects(
      () => selectCoachAction(data, accounting),
      /outside the coach's release/,
    );
    assert.equal(reservations, 2);
  } finally {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
