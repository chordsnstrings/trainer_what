// App checks that rejected correct model answers in the model trial of
// 30 September 2026 (findings N2, N3, N4, N7, N8 and N12 of the Brain tuning
// analysis), each with the protection it must keep. N1 (the weekly limit
// after rounding) is in brain-plans-timed.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  compiledRuleFlags,
  hasContactNumber,
  MEDICAL_ADVICE,
  numbersNotGrounded,
} from "../packages/domain/src/text-screen.ts";
import {
  evaluationAnswerIssues,
  fitUncertainties,
  planBoundsSchema,
  planDraftSchema,
  planLibrary,
  UNCERTAINTY_LIMITS,
} from "../packages/domain/src/brain-plans.ts";
import { requestMatchesTerm } from "../packages/domain/src/coaching-completion.ts";
import {
  compileTrainerRules,
  MODEL_CALL_BUDGETS,
  modelCallBudget,
  modelCallTimeoutMs,
  ModelOutputInvalid,
  ruleCompilePromptVersion,
  withRuntimeConfig,
} from "@trainer/providers";

const evaluationCtx = {
  library: planLibrary([], []),
  bounds: planBoundsSchema.parse({}),
  programExpected: false,
};
const answer = (message: string, reason = "Applied the trainer's rule.") => ({
  type: "progression",
  message,
  reason,
});

// ---------------------------------------------------------------------------
// N3: a decoded rule UUID is not a phone number.

// A trial rule id: "b947-4365-84" holds nine digits in one run.
const TRIAL_RULE_ID = "7466306a-b947-4365-84d6-2c29e8afd9c6";

test("a decoded rule UUID is not read as a phone number (N3)", () => {
  assert.equal(hasContactNumber(TRIAL_RULE_ID), false);
  assert.equal(hasContactNumber(`Followed ${TRIAL_RULE_ID} and 81c391bc-702c-41fc-9a6a-3abb4c90668b.`), false);
  assert.equal(hasContactNumber(`Rule ${TRIAL_RULE_ID.toUpperCase()} applies.`), false);
  const issues = evaluationAnswerIssues(
    { type: "escalation", message: "Please stop and rest; your trainer will reply personally.", reason: `Chest tightness: rule ${TRIAL_RULE_ID} refers this to the trainer.` },
    { ...evaluationCtx, citedText: "Chest tightness. Refer to the trainer." },
  );
  assert.deepEqual(issues, []);
});

test("phone numbers are still caught, also next to a UUID (N3)", () => {
  for (const text of [
    "Call me on +971 50 123 4567.",
    "WhatsApp 050-123-4567",
    "(04) 123 4567 any time",
    `${TRIAL_RULE_ID} call 0501234567`,
    `Text 0501234567 about ${TRIAL_RULE_ID}`,
    // A digits-only string in UUID shape is no record id.
    "12345678-1234-1234-1234-123456789012",
  ])
    assert.equal(hasContactNumber(text), true, text);
});

// ---------------------------------------------------------------------------
// N4: MEDICAL_ADVICE false alarms.

test("technique cues and declined topics are not medical advice (N4)", () => {
  for (const text of [
    "Push through the whole foot as you stand.",
    "Drive up and push through your heels.",
    "Push through it and stand tall.",
    "I made no diagnosis.",
    "I can't advise on supplements.",
    "I can't advise on supplements or medication, so your trainer will reply personally.",
    "I made no diagnosis and can't advise on supplements.",
    "I'm not able to give you advice on supplements.",
    "Supplements are outside what I can advise on.",
    "No diagnosis or medication advice was given.",
    "This is not a diagnosis.",
    "I won't diagnose anything here.",
    "Please stop and don't push through the pain.",
    "Never ignore chest pain; stop and message your trainer.",
    // A trainer rule against advice (compiled rule T1, model trial).
    "Never give supplement or medication advice.",
  ])
    assert.equal(MEDICAL_ADVICE.test(text), false, text);
  assert.deepEqual(
    compiledRuleFlags({ title: "Squat cue", condition: "Any squat", directive: "Push through the whole foot." }),
    [],
  );
  assert.deepEqual(
    compiledRuleFlags({ title: "Health questions", condition: "Supplement or medication questions", directive: "Never give supplement or medication advice." }),
    [],
  );
  assert.deepEqual(
    evaluationAnswerIssues(
      { type: "escalation", message: "Thank you; your trainer will reply personally.", reason: "Health question. I made no diagnosis and can't advise on supplements." },
      { ...evaluationCtx, citedText: "Refer health questions to the trainer." },
    ),
    [],
  );
});

test("medical advice still fails, also in a sentence that declines a topic (N4)", () => {
  // Must-still-fail table: [text, why].
  const mustFail: Array<[string, string]> = [
    ["Push through the pain.", "training through pain"],
    ["If it hurts, push through it.", "pain earlier in the sentence"],
    ["Push through the whole foot even if it hurts.", "technique cue that also says to train through pain"],
    ["Push through the discomfort, it will ease.", "discomfort"],
    ["Don't stop, push through the pain.", "the negation is on stopping"],
    ["Don't worry, just push through the pain.", "the negation is on worrying"],
    ["Train through the pain.", "through the pain"],
    ["Ignore the pain.", "ignore a symptom"],
    ["Keep going, no pain no gain.", "no pain no gain"],
    ["I made no diagnosis, but take ibuprofen before bed.", "a medicine after the disclaimer"],
    ["I made no diagnosis but you should take a supplement.", "a supplement after the disclaimer"],
    ["I can't advise on supplements, but 5 mg of melatonin helps.", "a dose after the disclaimer"],
    ["I can't advise on supplements, take two painkillers.", "painkillers after the disclaimer"],
    ["I can't diagnose this, but it is probably tendinitis.", "a diagnosis after the disclaimer"],
    ["No diagnosis was made; it is probably tendinitis.", "a diagnosis in the next sentence"],
    ["You don't need a diagnosis, push through the pain.", "training through pain"],
    ["I can't advise on ibuprofen.", "a named medicine, even when declined"],
    ["I can't advise on supplements or ibuprofen.", "a named medicine in the declined list"],
    ["I don't recommend ibuprofen before training.", "advice against a medicine"],
    ["Don't stop your medication.", "advice on medication"],
    ["Double your dose.", "a dose"],
    ["Never give ibuprofen advice; take paracetamol instead.", "a named medicine in the rule, then advice"],
    ["Don't give up your medication.", "advice on medication"],
    ["Never recommend supplements above 5 mg.", "a dose after the declined topic"],
    ["Take a supplement after training.", "a supplement"],
    ["It is just a strain.", "a diagnosis"],
  ];
  for (const [text, why] of mustFail) assert.equal(MEDICAL_ADVICE.test(text), true, `${text} (${why})`);
  assert.ok(
    compiledRuleFlags({ title: "Heavy legs", condition: "Late in a set", directive: "Push through the pain." }).includes(
      "medical_advice",
    ),
  );
});

// ---------------------------------------------------------------------------
// N2: numbers from the request and applying the rule to them.

const progressionRule = "Progression. All sets at RIR 2. Add 2.5 kg to the lift next session.";
const squatRequest = "I squatted 100 kg for four sets of five at RIR 2. What next?";

test("the release check accepts request numbers and the rule applied to them (N2)", () => {
  // T1/release_eval/re1: all three models answered this way.
  const message =
    "Strong work. All four sets at 100 kg with RIR 2 means you earned the next step. Next session, squat 102.5 kg for the same four sets.";
  assert.deepEqual(
    evaluationAnswerIssues(answer(message), { ...evaluationCtx, citedText: progressionRule, requestText: squatRequest }),
    [],
  );
  assert.deepEqual(numbersNotGrounded("Five weeks in, wait 7 more weeks.", "No running before 12 weeks postpartum.", "I am five weeks postpartum."), []);
  assert.deepEqual(numbersNotGrounded("Go from 80 kg to 84 kg, or 76 kg on a bad day.", "Change the load by 5%.", "I lift 80 kg."), []);
  assert.deepEqual(numbersNotGrounded("Drop to 97.5 kg.", progressionRule, squatRequest), []);
});

test("any other new number is still an altered number (N2)", () => {
  const issues = (message: string, requestText = squatRequest, citedText = progressionRule) =>
    evaluationAnswerIssues(answer(message), { ...evaluationCtx, citedText, requestText });
  assert.deepEqual(issues("Add 10 kg next session."), ["altered_numbers"]);
  assert.deepEqual(issues("Squat 105 kg next session."), ["altered_numbers"]);
  // A doubled number is not a simple result ("six sessions" for three).
  assert.deepEqual(
    issues("Train six sessions a week.", "I train 3 sessions a week.", "Frequency. Three sessions a week."),
    ["altered_numbers"],
  );
  // Without the request text only the rule's numbers count.
  assert.deepEqual(
    evaluationAnswerIssues(answer("Squat 102.5 kg next."), { ...evaluationCtx, citedText: progressionRule }),
    ["altered_numbers"],
  );
  assert.deepEqual(numbersNotGrounded("Go to 90 kg.", "Change the load by 5%.", "I lift 80 kg."), ["90"]);
});

// ---------------------------------------------------------------------------
// N7: time allowances per model family, and short references for compiling.

test("rule compile and meal photo allow a slower model family more time (N7)", () => {
  for (const model of ["gpt-4.1", "claude-sonnet-4-5", "fixture-model", "seedance-1-0", undefined])
    for (const task of ["rule_compilation", "meal_photo"] as const)
      assert.equal(modelCallTimeoutMs(task, model), MODEL_CALL_BUDGETS[task].timeoutMs, `${model} ${task}`);
  assert.equal(MODEL_CALL_BUDGETS.rule_compilation.timeoutMs, 30000);
  assert.equal(MODEL_CALL_BUDGETS.meal_photo.timeoutMs, 30000);
  // Seed 2.0 Pro needed 46 to 56 s to compile and 37 s for a photo.
  for (const model of ["seed-2-0-pro-260328", "doubao-seed-1-6-250615", "Seed-2.0-Pro"]) {
    assert.ok(modelCallTimeoutMs("rule_compilation", model) >= 60000, model);
    assert.ok(modelCallTimeoutMs("meal_photo", model) >= 45000, model);
    // The call itself gets that allowance through the one budget mechanism
    // (classic request style, multiplier 1 by default).
    assert.ok(modelCallBudget("rule_compilation", { MODEL_NAME: model }).timeoutMs >= 60000, model);
    assert.ok(modelCallBudget("meal_photo", { MODEL_NAME: model }).timeoutMs >= 45000, model);
    // Other call sites keep their own limits.
    assert.equal(modelCallBudget("coach_selection", { MODEL_NAME: model }).timeoutMs, 30000, model);
  }
});

const modelConfig = {
  MODEL_BASE_URL: "https://compile.fixture.invalid/v1",
  MODEL_API_KEY: "fixture-only",
  MODEL_NAME: "fixture-model",
};
const accounting = { reserve: async () => {}, record: async () => {} };
const teaching = (text: string) => ({
  id: randomUUID(),
  data: { title: "Reviewed fixture", text, allowedUses: ["model_prompt", "trainer_specific_learning"] },
});

async function compileWith(reply: (sent: any) => unknown) {
  const sources = [teaching("Add 2.5 kg when every set is at RIR 2."), teaching("Deload every fourth week.")];
  const originalFetch = globalThis.fetch;
  let system = "",
    sent: any = null;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    system = body.messages[0].content;
    sent = JSON.parse(body.messages[1].content);
    return Response.json({
      id: "fixture-compile",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ message: { content: JSON.stringify(reply(sent)) } }],
    });
  };
  try {
    const result = await withRuntimeConfig(modelConfig, () => compileTrainerRules(sources, accounting as any));
    return { sources, system, sent, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("compileTrainerRules sends short source references and maps them back (N7)", async () => {
  const { sources, system, sent, result } = await compileWith(() => ({
    rules: [
      { title: "Add 2.5 kg after clean sets", category: "progression", condition: "All sets at RIR 2", directive: "Add 2.5 kg", reason: "Stated in S1", sourceIds: ["S1"] },
    ],
    conflicts: [{ description: "Deload timing is not stated for travel weeks", sourceIds: ["S1", "S2"] }],
  }));
  assert.match(system, /^Extract draft coaching rules/);
  assert.ok(system.includes(ruleCompilePromptVersion));
  assert.equal(ruleCompilePromptVersion, "rule-compile-v2");
  assert.deepEqual(
    sent.map((s: any) => s.id),
    ["S1", "S2"],
  );
  assert.ok(!JSON.stringify(sent).includes(sources[0]!.id));
  assert.deepEqual(result.rules[0]!.sourceIds, [sources[0]!.id]);
  assert.deepEqual(result.conflicts[0]!.sourceIds, [sources[0]!.id, sources[1]!.id]);
  assert.equal(result.promptVersion, ruleCompilePromptVersion);
  assert.equal(result.coverage.promptVersion, ruleCompilePromptVersion);
});

test("a compile reply citing a source it was not shown is still withheld (N7)", async () => {
  await assert.rejects(
    compileWith(() => ({
      rules: [{ title: "Invented", category: "progression", condition: "Always", directive: "Add 2.5 kg", reason: "S9", sourceIds: ["S9"] }],
      conflicts: [],
    })),
    ModelOutputInvalid,
  );
  await assert.rejects(
    compileWith(() => ({
      rules: [{ title: "Foreign", category: "progression", condition: "Always", directive: "Add 2.5 kg", reason: "x", sourceIds: [randomUUID()] }],
      conflicts: [],
    })),
    ModelOutputInvalid,
  );
});

// ---------------------------------------------------------------------------
// N8: a long uncertainty note is trimmed, not a reason to reject the draft.

const draftWithNotes = (uncertainties: string[]) => ({
  title: "Four week strength block",
  summary: "Three sessions a week.",
  sessions: [
    {
      key: "A",
      label: "Full body",
      weekday: 1,
      exercises: [
        { name: "Goblet Squat", sets: 3, reps: 10, loadKg: 10, rir: 2, restSeconds: 60, cue: "", alternatives: [] },
      ],
    },
  ],
  weeks: [{ week: 1, focus: "Technique", volumeFactor: 1, loadFactor: 1, rirDelta: 0, deload: false }],
  selfConfidence: 0.8,
  uncertainties,
  evidenceIds: [],
});

test("an uncertainty note over the limit is trimmed and marked, not rejected (N8)", () => {
  const long = `Rule ${TRIAL_RULE_ID} and the member's notes disagree about the knee; ` + "please confirm. ".repeat(20);
  assert.ok(long.length > UNCERTAINTY_LIMITS.characters);
  const reply = draftWithNotes(["Short note.", long]);
  assert.equal(planDraftSchema.safeParse(reply).success, false);
  const fitted = fitUncertainties(reply);
  assert.equal(fitted.trimmed, 1);
  assert.equal(fitted.dropped, 0);
  const draft = planDraftSchema.parse(fitted.value);
  assert.equal(draft.uncertainties[0], "Short note.");
  assert.equal(draft.uncertainties[1]!.length <= UNCERTAINTY_LIMITS.characters, true);
  assert.match(draft.uncertainties[1]!, /… \[trimmed\]$/);
  assert.ok(draft.uncertainties[1]!.startsWith(long.slice(0, 200)));
  // The original reply is not changed.
  assert.equal(reply.uncertainties[1], long);
});

test("notes beyond the tenth are dropped and the tenth says so (N8)", () => {
  const notes = Array.from({ length: 13 }, (_, i) => `Note ${i + 1}.`);
  const fitted = fitUncertainties(draftWithNotes(notes));
  assert.equal(fitted.dropped, 3);
  const draft = planDraftSchema.parse(fitted.value);
  assert.equal(draft.uncertainties.length, UNCERTAINTY_LIMITS.notes);
  assert.equal(draft.uncertainties[9], "Note 10. [3 more notes left out]");
  // Within the limits nothing changes; a wrong shape is left for the schema.
  const fine = draftWithNotes(["One.", "Two."]);
  assert.equal(fitUncertainties(fine).value, fine);
  const wrong = { ...fine, uncertainties: "not a list" };
  assert.equal(fitUncertainties(wrong).value, wrong);
  assert.equal(planDraftSchema.safeParse(fitUncertainties(draftWithNotes(["", "x"])).value).success, false);
});

// ---------------------------------------------------------------------------
// N12: word-level request-term matching.

test("request terms match at word level with possessives and simple inflections (N12)", () => {
  const matches: Array<[string, string]> = [
    // T1S04/chat2: a plainly eligible one-day move.
    ["Can I move tomorrow's session? My flight lands late.", "move my session"],
    ["Could I move the Tuesday session?", "move my session"],
    ["Can we move session to Friday?", "move my session"],
    ["Is moving my session ok?", "move my session"],
    ["Can you move my sessions this week?", "move my session"],
    ["I need to reschedule", "reschedule"],
    ["Can I skip tomorrow?", "skip"],
    ["My coach's feedback was clear", "coach feedback"],
    ["I feel tired", "tired"],
  ];
  for (const [text, term] of matches) assert.equal(requestMatchesTerm(text, term), true, `${text} / ${term}`);
  const misses: Array<[string, string]> = [
    ["Can you remove my session?", "move my session"],
    ["Watching a movie after my session", "move my session"],
    ["I have an obsession with running", "session"],
    ["My car tires are flat", "tired"],
    ["i only have my bandana", "band"],
    ["Can I move tomorrow?", "move my session"],
    ["Move it", "move my session"],
    ["I skipper the boat", "skip"],
    // Safety review: the past tense reports what happened, it is not a request.
    ["I moved my session already", "move my session"],
    ["I rescheduled my flight", "reschedule"],
    ["I skipped the run", "skip"],
    // A one-word term matches exactly: "increasing" describes, it does not ask.
    ["Rescheduling tomorrow, sorry", "reschedule"],
    ["I am skipping legs", "skip"],
  ];
  for (const [text, term] of misses) assert.equal(requestMatchesTerm(text, term), false, `${text} / ${term}`);
  // Arabic matching is unchanged.
  assert.equal(requestMatchesTerm("ممكن تأجيل الحصة؟", "تأجيل الحصة"), true);
  assert.equal(requestMatchesTerm("تأجيل حصة الغد", "تأجيل الحصة"), true);
  assert.equal(requestMatchesTerm("تأجيلات الحصص", "تأجيل الحصة"), false);
});
