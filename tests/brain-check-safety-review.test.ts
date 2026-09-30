// Safety review of the model-trial check fixes (N2, N3, N4, N8, N12; commit
// 0d38ed4): inputs that the loosened checks let through but must not. Each
// case failed on 0d38ed4 and passes after the review fix. The fixes' own
// tests are in brain-check-false-alarms.test.ts and brain-plans-timed.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compiledRuleFlags,
  givesMedicalAdvice,
  hasContactNumber,
  MEDICAL_ADVICE,
  numbersNotGrounded,
} from "../packages/domain/src/text-screen.ts";
import {
  carriesSafetyPoint,
  evaluationAnswerIssues,
  fitUncertainties,
  planBoundsSchema,
  planDraftSchema,
  planLibrary,
  UNCERTAINTY_LIMITS,
} from "../packages/domain/src/brain-plans.ts";
import { requestMatchesTerm } from "../packages/domain/src/coaching-completion.ts";

const evaluationCtx = {
  library: planLibrary([], []),
  bounds: planBoundsSchema.parse({}),
  programExpected: false,
};
const answer = (message: string, reason = "Applied the trainer's rule.") => ({ type: "progression", message, reason });

// ---------------------------------------------------------------------------
// N4: training through pain named in another sentence or in the request, and
// advice hidden after a declined topic.

test("a push-through refers back to pain named in another sentence (N4 review)", () => {
  for (const text of [
    "Knee pain? Push through it.",
    "Feeling a twinge in your shoulder. Push through it for the last set.",
    "If it hurts: push through.",
    "Sore back? Just push through and finish the set.",
    "Don't worry about it; the pain is normal, push through it.",
  ])
    assert.equal(MEDICAL_ADVICE.test(text), true, text);
  // A technique cue next to a safety instruction still passes.
  for (const text of [
    "Push through your heels. Stop and message your trainer if you feel sharp pain.",
    "Push through the whole foot; stop if anything hurts.",
    "Push through it and stand tall.",
  ])
    assert.equal(MEDICAL_ADVICE.test(text), false, text);
});

test("the request and a rule's condition give a push-through its pain (N4 review)", () => {
  assert.equal(givesMedicalAdvice("Push through it and finish the set."), false);
  assert.equal(givesMedicalAdvice("Push through it and finish the set.", "My knee hurts on the last reps."), true);
  assert.equal(givesMedicalAdvice("Push through your heels.", "My knee hurts on the last reps."), false);
  assert.deepEqual(
    evaluationAnswerIssues(answer("Push through it and finish all sets."), {
      ...evaluationCtx,
      citedText: "Finish all sets.",
      requestText: "My knee hurts on the last reps of squats. What should I do?",
    }),
    ["medical"],
  );
  assert.ok(
    compiledRuleFlags({ title: "Knee soreness", condition: "The member's knee is sore during squats", directive: "Push through it." }).includes(
      "medical_advice",
    ),
  );
  assert.deepEqual(
    compiledRuleFlags({ title: "Squat cue", condition: "Any squat", directive: "Push through the whole foot." }),
    [],
  );
});

test("a declined topic does not carry the next clause with it (N4 review)", () => {
  for (const text of [
    "I can't advise on medication, painkillers will sort it out.",
    "I can't recommend supplements and painkillers are your best bet.",
    "I can't comment on supplements and medication, doses of 400 are fine.",
    "I can't advise on supplements or pills, medication is what you need.",
    "I gave no supplements and pills will help.",
    "I won't diagnose you, but it's just a strain.",
    "I can't diagnose this, but it is probably just a strain.",
    "It's most likely nothing.",
  ])
    assert.equal(MEDICAL_ADVICE.test(text), true, text);
  // Declined lists still pass.
  for (const text of [
    "I can't advise on supplements, medication or pills.",
    "I can't advise on supplements or medication, so your trainer will reply personally.",
    "I made no diagnosis and can't advise on supplements.",
    "Never give supplement or medication advice.",
    "No diagnosis or medication advice was given.",
    "Supplements and medication are outside what I can advise on.",
  ])
    assert.equal(MEDICAL_ADVICE.test(text), false, text);
});

// ---------------------------------------------------------------------------
// N2: a request number and a rule number combine only in the same unit.

const progressionRule = "Progression. All sets at RIR 2. Add 2.5 kg to the lift next session.";
const squatRequest = "I squatted 100 kg for four sets of five at RIR 2. What next?";

test("an invented number that happens to be a request number plus a rule number is still altered (N2 review)", () => {
  // 100 kg + RIR 2, four sets + RIR 2, five reps + RIR 2.
  assert.deepEqual(numbersNotGrounded("Squat 102 kg next session.", progressionRule, squatRequest), ["102"]);
  assert.deepEqual(numbersNotGrounded("Do six sets of seven at 100 kg.", progressionRule, squatRequest), ["6", "7"]);
  assert.deepEqual(
    evaluationAnswerIssues(answer("Next session squat 102 kg for six sets."), {
      ...evaluationCtx,
      citedText: progressionRule,
      requestText: squatRequest,
    }),
    ["altered_numbers"],
  );
  // 10 weeks - 3 sessions.
  assert.deepEqual(
    numbersNotGrounded(
      "Train 7 sessions a week.",
      "Frequency. Three sessions a week. Deload every 4 weeks.",
      "I train 3 sessions a week and have 10 weeks until my race.",
    ),
    ["7"],
  );
  // 4 weeks + 2 weeks is not a number of sessions.
  assert.deepEqual(
    numbersNotGrounded("Train 6 sessions a week.", "At most 3 sessions a week in 4 week blocks.", "I did 3 sessions in 2 weeks."),
    ["6"],
  );
  // A 100% rule does not make a doubled number a percentage step.
  assert.deepEqual(
    numbersNotGrounded("Train 6 sessions a week.", "Complete 100% of sessions.", "I train 3 sessions a week."),
    ["6"],
  );
  // The correct results still pass.
  assert.deepEqual(numbersNotGrounded("Squat 102.5 kg, or 97.5 kg on a bad day.", progressionRule, squatRequest), []);
  assert.deepEqual(numbersNotGrounded("Wait 7 more weeks.", "No running before 12 weeks postpartum.", "I am five weeks postpartum."), []);
  assert.deepEqual(numbersNotGrounded("Go to 84 kg, or 76 kg.", "Change the load by 5 per cent.", "I lift 80 kg."), []);
  assert.deepEqual(numbersNotGrounded("Keep RIR 2 at 100 kg for four sets.", progressionRule, squatRequest), []);
});

// ---------------------------------------------------------------------------
// N3: a phone number next to a rule UUID.

test("a phone number beside or around a rule UUID is still a contact number (N3 review)", () => {
  const id = "7466306a-b947-4365-84d6-2c29e8afd9c6";
  for (const text of [
    `Call 0791 123 4567 about rule ${id}`,
    `${id} 07911234567`,
    `rule ${id}+447911123456`,
    `WhatsApp 0501234567-${id}`,
    `phone:0501234567/${id}`,
    `dial 050-123-4567_${id}`,
  ])
    assert.equal(hasContactNumber(text), true, text);
  assert.equal(hasContactNumber(`Rules ${id} and ${id.toUpperCase()} apply.`), false);
});

// ---------------------------------------------------------------------------
// N12: past tense, contractions and someone else's session are not requests.

test("a report or someone else's session does not make an action eligible (N12 review)", () => {
  const misses: Array<[string, string]> = [
    ["I already moved my session to Thursday, is that ok?", "move my session"],
    ["I skipped my session yesterday, what now?", "skip my session"],
    ["I cancelled my session last week.", "cancel my session"],
    ["I rescheduled last week", "reschedule"],
    ["Please don't cancel, that's my session!", "cancel my session"],
    ["Should I skip? It's my session with heavy squats.", "skip my session"],
    ["Move? It's session day!", "move my session"],
    ["Can you move her session instead of mine?", "move my session"],
    ["My friend moved their session", "move my session"],
    ["My tiredness is increasing every week", "increase"],
    ["My squat progresses slowly", "progress"],
    ["I am skipping legs", "skip"],
  ];
  for (const [text, term] of misses) assert.equal(requestMatchesTerm(text, term), false, `${text} / ${term}`);
  const matches: Array<[string, string]> = [
    ["Can I move tomorrow's session? My flight lands late.", "move my session"],
    ["Could I move Friday's session?", "move my session"],
    ["Can I move next week's session?", "move my session"],
    ["Can I move my coach's session?", "move my session"],
    ["Please move your session with me", "move your session"],
    ["Can you cancel my session?", "cancel your session"],
    ["I'm moving my session to Friday", "move my session"],
    ["Please mark it moved", "moved"],
    ["Can I reschedule?", "reschedule"],
    ["Is my coach's plan ready?", "coach"],
  ];
  for (const [text, term] of matches) assert.equal(requestMatchesTerm(text, term), true, `${text} / ${term}`);
});

// ---------------------------------------------------------------------------
// N8: trimming never hides a safety point from the trainer.

const draftWithNotes = (uncertainties: string[]) => ({
  title: "Four week strength block",
  summary: "Three sessions a week.",
  sessions: [
    {
      key: "A",
      label: "Full body",
      weekday: 1,
      exercises: [{ name: "Goblet Squat", sets: 3, reps: 10, loadKg: 10, rir: 2, restSeconds: 60, cue: "", alternatives: [] }],
    },
  ],
  weeks: [{ week: 1, focus: "Technique", volumeFactor: 1, loadFactor: 1, rirDelta: 0, deload: false }],
  selfConfidence: 0.8,
  uncertainties,
  evidenceIds: [],
});

test("a note whose cut part carries a safety point is not trimmed (N8 review)", () => {
  const filler = "Week 2 uses a moderate step because the member logged all sets. ".repeat(5);
  for (const tail of [
    "The member reported chest pain on exertion last week; confirm before approving.",
    "The member mentioned knee surgery three weeks ago; confirm clearance.",
    "The member is pregnant; check the plan.",
  ]) {
    const reply = draftWithNotes(["Short note.", filler + tail]);
    const fitted = fitUncertainties(reply);
    assert.equal(fitted.withheld, true, tail);
    assert.equal(fitted.value, reply);
    assert.equal(planDraftSchema.safeParse(fitted.value).success, false, tail);
  }
  // A phrase split by the cut is read whole.
  const split = "x".repeat(UNCERTAINTY_LIMITS.characters - " … [trimmed]".length - 6) + " chest pain reported.";
  assert.equal(fitUncertainties(draftWithNotes([split])).withheld, true);
  // A safety point inside the kept part is fine.
  const early = "The member reported chest pain once; confirm. " + "Please confirm the weekly plan. ".repeat(12);
  const kept = fitUncertainties(draftWithNotes([early]));
  assert.equal(kept.withheld, false);
  assert.equal(kept.trimmed, 1);
  assert.ok(planDraftSchema.parse(kept.value).uncertainties[0]!.includes("chest pain"));
});

test("notes with a safety point are kept before others when notes are dropped (N8 review)", () => {
  const notes = Array.from({ length: 12 }, (_, i) => `Note ${i + 1}.`);
  notes[10] = "Member mentioned knee surgery three weeks ago; confirm clearance.";
  notes[11] = "The member reported dizziness after intervals.";
  const fitted = fitUncertainties(draftWithNotes(notes));
  assert.equal(fitted.withheld, false);
  assert.equal(fitted.dropped, 2);
  const kept = planDraftSchema.parse(fitted.value).uncertainties;
  assert.equal(kept.length, UNCERTAINTY_LIMITS.notes);
  assert.ok(kept.some((n) => n.includes("knee surgery")));
  assert.ok(kept.some((n) => n.includes("dizziness")));
  assert.ok(!kept.includes("Note 9.") && !kept.includes("Note 10."));
  assert.match(kept.at(-1)!, /\[2 more notes left out\]$/);
  // More safety notes than fit: nothing is dropped, the schema rejects.
  const many = Array.from({ length: 11 }, (_, i) => `Safety ${i + 1}: the member reported knee pain.`);
  const all = fitUncertainties(draftWithNotes(many));
  assert.equal(all.withheld, true);
  assert.equal(planDraftSchema.safeParse(all.value).success, false);
  assert.equal(carriesSafetyPoint("Please confirm the weekly plan."), false);
});
