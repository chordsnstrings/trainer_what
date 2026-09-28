// Pure voice-session rules: script validation, the runner state machine and
// spoken-reply parsing (packages/domain/src/voice-session.ts, voice-runner.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustmentAllowed,
  buildSessionScript,
  checkedSuggestions,
  cueIssues,
  defaultVoiceStyle,
  numberClipKeys,
  phraseIssues,
  planExercises,
  reducedLoad,
  scriptIssues,
  scriptLines,
  sharedClips,
  spokenLines,
  styleIssues,
  voiceStyleSchema,
  PlanError,
  SHARED_PHRASES,
  VOICE_SAFETY_LINE,
  type SessionScript,
} from "../packages/domain/src/voice-session.ts";
import {
  ECHO_GRACE_MS,
  heardReply,
  initialRunnerState,
  isPromptEcho,
  parseVoiceCommand,
  runnerStatus,
  stepRunner,
  type RunnerEffect,
  type RunnerEvent,
  type RunnerState,
} from "../packages/domain/src/voice-runner.ts";

const plan = planExercises({
  title: "Lower body",
  exercises: [
    { name: "Back squat", sets: 3, reps: 8, loadKg: 60, restSeconds: 30, cue: "Brace, then sit between your heels." },
    { name: "Push-up", sets: 1, reps: 10, restSeconds: 0 },
  ],
});
const built = () => buildSessionScript({ title: "Lower body", exercises: plan }).script;
const clone = (s: SessionScript): SessionScript => JSON.parse(JSON.stringify(s));

test("free wording may not carry numbers, medical advice, red flags, prescription changes or links", () => {
  for (const [text, issue] of [
    ["Do 3 more reps", "number"],
    ["Give me two more", "number"],
    ["Go for a dozen", "number"],
    ["خمس مرات", "number"],
    ["Take ibuprofen after this", "medical"],
    ["Ice it and see a physio", "medical"],
    ["No pain, no gain", "medical"],
    ["Push through the pain", "medical"],
    ["If your chest hurts keep going", "red_flag"],
    ["Feeling dizzy is normal", "red_flag"],
    ["Add weight when it feels easy", "prescription_change"],
    ["Try an extra set today", "prescription_change"],
    ["Go heavier next time", "prescription_change"],
    // Failure, ignoring symptoms, skipping the warm-up and unsafe technique.
    ["Keep going until you can't move the bar.", "prescription_change"],
    ["Squeeze out a few extra if you can.", "prescription_change"],
    ["Skip the warm-up today and go straight in.", "prescription_change"],
    ["If your shoulder clicks, just keep going.", "medical"],
    ["Keep going even if it aches.", "medical"],
    ["Work through the burn", "medical"],
    ["Hold your breath and strain hard.", "unsafe_technique"],
    ["Round your back and yank the bar up.", "unsafe_technique"],
    ["Visit https://example.com", "link"],
    ["<b>Great</b>", "unsupported_characters"],
    ["x".repeat(201), "too_long"],
  ] as const)
    assert.ok(phraseIssues(text).includes(issue), `${text} -> ${issue}: ${phraseIssues(text)}`);
  for (const ok of ["Great work!", "Let's get to it.", "Stay tall and breathe out as you push.", "Well done, everyone.", "Don't round your back.", "Don't hold your breath."])
    assert.deepEqual(phraseIssues(ok), [], ok);
  const style = voiceStyleSchema.parse({ encouragement: ["Nice.", "Do 5 more"], cooldown: ["Stretch well"] });
  assert.deepEqual(styleIssues(style), [{ field: "encouragement", index: 1, issues: ["number"] }]);
});

test("the plan is read strictly and unsupported workouts are refused", () => {
  assert.equal(plan[0].loadKg, 60);
  assert.equal(plan[1].loadKg, 0);
  assert.equal(plan[1].rir, 2);
  assert.throws(() => planExercises({ exercises: [] }), PlanError);
  assert.throws(() => planExercises({ exercises: [{ name: "Squat", sets: 0, reps: 8 }] }), PlanError);
  assert.throws(() => planExercises({ exercises: [{ name: "Squat", sets: 3, reps: "lots" }] }), PlanError);
  // Legacy numeric strings are accepted as numbers.
  assert.equal(planExercises({ exercises: [{ name: "Lunge", sets: 2, reps: "6", restSeconds: 45 }] })[0].reps, 6);
});

test("every number is written by code from the plan and the script validates", () => {
  const script = built();
  assert.deepEqual(scriptIssues(script, plan), []);
  assert.equal(script.exercises[0].setLines.length, 3);
  assert.equal(script.exercises[0].setLines[1].text, "Set 2 of 3. 8 reps at 60 kilograms. Say done when you finish, or tell me how many reps you did.");
  assert.equal(script.exercises[0].setup.text, "Exercise 1 of 2: Back squat. 3 sets of 8 reps at 60 kilograms.");
  assert.equal(script.exercises[1].setup.text, "Last exercise: Push-up. 1 set of 10 reps.");
  assert.equal(script.exercises[0].cueLine?.text, "Brace, then sit between your heels.");
  assert.equal(script.intro.at(-1)?.text, VOICE_SAFETY_LINE);
  // No load reduction and no skipping until the trainer opts in.
  assert.deepEqual(script.rules, { tooHeavyReducePercent: 0, allowSkip: false });
  // Rest prompts that can never play get no audio.
  const spoken = spokenLines(script).map((l) => l.id);
  assert.ok(spoken.includes("ex:0:rest"));
  assert.ok(!spoken.includes("ex:1:rest"));
  assert.ok(!spoken.includes("ex:1:rest_end"));
  assert.equal(new Set(scriptLines(script).map((l) => l.id)).size, scriptLines(script).length);
});

test("a changed number, rule, safety line or wording makes the stored script invalid", () => {
  const load = clone(built());
  load.exercises[0].setLines[0].text = load.exercises[0].setLines[0].text.replace("60", "80");
  assert.ok(scriptIssues(load, plan).some((i) => i.startsWith("changed:ex:0:set:1")));
  const reps = clone(built());
  reps.exercises[0].reps = 12;
  assert.ok(scriptIssues(reps, plan).includes("prescription:0"));
  const extra = clone(built());
  extra.exercises[0].setLines.push({ ...extra.exercises[0].setLines[0], id: "ex:0:set:4" });
  assert.ok(scriptIssues(extra, plan).includes("set_count:0"));
  const rules = clone(built());
  (rules.rules as any).tooHeavyReducePercent = 90;
  assert.deepEqual(scriptIssues(rules, plan), ["rules"]);
  const safety = clone(built());
  safety.intro = safety.intro.filter((l) => l.kind !== "safety");
  assert.ok(scriptIssues(safety, plan).includes("safety_line"));
  const wording = clone(built());
  wording.exercises[0].encouragement[0].text = "Now add 10 kilos";
  assert.ok(scriptIssues(wording, plan).some((i) => i.startsWith("wording:ex:0:encourage:0")));
  assert.deepEqual(scriptIssues(built(), plan.slice(0, 1)), ["exercise_count"]);
});

test("Brain suggestions are checked for the trainer's review; only the trainer's saved phrases are spoken", () => {
  const style = voiceStyleSchema.parse({ tone: "energetic", encouragement: ["That's the way!"], finish: ["See you next time."] });
  const { accepted, rejected } = checkedSuggestions(
    {
      intro: ["Welcome back, let's move well today."],
      encouragement: ["Do 2 extra reps!", "Take paracetamol", "That's the way!", "Keep going until you can't move the bar."],
      cooldown: ["Walk it off slowly."],
    },
    style,
  );
  assert.deepEqual(accepted.intro, ["Welcome back, let's move well today."]);
  // Already in the style, so not suggested again.
  assert.deepEqual(accepted.encouragement, []);
  assert.deepEqual(rejected.map((r) => r.issues[0]), ["number", "medical", "prescription_change"]);
  // The script uses the trainer's phrases, then the tone's defaults; nothing else.
  const { script } = buildSessionScript({ title: "Lower body", exercises: plan, style });
  assert.equal(script.exercises[0].encouragement[0].text, "That's the way!");
  assert.equal(script.exercises[0].encouragement[0].owner, "trainer");
  assert.equal(script.intro[0].owner, "code");
  assert.equal(script.finish.text, "See you next time.");
  assert.ok(scriptLines(script).every((l) => l.owner === "code" || l.owner === "trainer"));
  assert.deepEqual(scriptIssues(script, plan), []);
  const forged = clone(script);
  (forged.intro[0] as any).owner = "brain";
  assert.ok(scriptIssues(forged, plan).includes("owner:intro:0"));
});

test("the plan cue gets the red-flag, medical, prescription and technique checks; numbers only as tempo", () => {
  for (const [text, issue] of [
    ["Go to failure; ignore dizziness, chest pain is normal", "red_flag"],
    ["Go to failure; ignore dizziness, chest pain is normal", "prescription_change"],
    ["Do 5 extra sets", "prescription_change"],
    ["Do five sets", "prescription_change"],
    ["Add two more", "prescription_change"],
    ["Use 20 kg", "prescription_change"],
    ["Go 2 inches deeper", "number"],
    ["Take ibuprofen first", "medical"],
    ["Hold your breath at the bottom", "unsafe_technique"],
  ] as const)
    assert.ok(cueIssues(text).includes(issue), `${text} -> ${issue}: ${cueIssues(text)}`);
  for (const ok of [
    "Brace, then sit between your heels.",
    "Three seconds down, pause, drive up.",
    "3-1-1 tempo.",
    "Lower for 3 seconds.",
    "Pause for a count of two at the bottom.",
    "Keep one foot planted.",
    "Don't round your back.",
  ])
    assert.deepEqual(cueIssues(ok), [], ok);
  const cue = buildSessionScript({
    title: "x",
    exercises: [{ ...plan[0], cue: "Go to failure; chest pain is normal" }],
  });
  assert.equal(cue.script.exercises[0].cueLine, null);
  assert.equal(cue.rejected[0].source, "cue");
  // A stored script whose cue no longer passes is refused.
  const stored = clone(built());
  stored.exercises[0].cueLine!.text = "Do 5 extra sets";
  assert.ok(scriptIssues(stored, [{ ...plan[0], cue: "Do 5 extra sets" }, plan[1]]).includes("cue:0"));
});

test("load reductions stay within the trainer's rule and never raise the plan", () => {
  const rules = { tooHeavyReducePercent: 10, allowSkip: true };
  assert.equal(reducedLoad(60, rules), 54);
  assert.equal(reducedLoad(2.5, rules), 2);
  assert.equal(reducedLoad(0, rules), null);
  assert.equal(reducedLoad(60, { ...rules, tooHeavyReducePercent: 0 }), null);
  const prescribed = { reps: 8, loadKg: 60 };
  assert.equal(adjustmentAllowed(prescribed, { reps: 8, loadKg: 54 }, rules), true);
  assert.equal(adjustmentAllowed(prescribed, { reps: 8, loadKg: 53.5 }, rules), false);
  assert.equal(adjustmentAllowed(prescribed, { reps: 8, loadKg: 62 }, rules), false);
  assert.equal(adjustmentAllowed(prescribed, { reps: 9, loadKg: 54 }, rules), false);
  assert.equal(adjustmentAllowed(prescribed, { reps: 8, loadKg: 55.3 }, rules), false);
  assert.deepEqual(numberClipKeys(52.5), ["num:52", "point_five"]);
  assert.equal(numberClipKeys(120), null);
  assert.equal(numberClipKeys(52.25), null);
  const shared = sharedClips();
  assert.equal(shared.filter((c) => c.key.startsWith("num:")).length, 100);
  assert.ok(shared.some((c) => c.key === "stopping"));
});

test("spoken replies map to commands; pain and red flags always win", () => {
  const cases: Array<[string, string, number?]> = [
    ["done", "done"],
    ["Finished!", "done"],
    // Acknowledgements and "go" never complete a set.
    ["okay", "ack"],
    ["yes", "ack"],
    ["yeah sure", "ack"],
    ["let's go", "resume"],
    ["ready", "resume"],
    ["next", "resume"],
    // Negated effort is not a complaint.
    ["not heavy", "unknown"],
    ["it's not too heavy", "unknown"],
    ["wasn't that hard", "unknown"],
    ["not easy at all", "unknown"],
    ["can't lift it", "too_heavy"],
    // A number names reps only; sets, loads and times are not reps.
    ["60 kilograms is too heavy", "too_heavy"],
    ["skip set 2", "skip"],
    ["eight reps", "reps", 8],
    ["I did 12", "reps", 12],
    ["twenty five", "reps", 25],
    ["٨", "reps", 8],
    ["too heavy", "too_heavy"],
    ["this is way too hard", "too_heavy"],
    ["too easy", "too_easy"],
    ["pause", "pause"],
    ["one moment please", "pause"],
    ["stop", "pause"],
    ["resume", "resume"],
    ["skip", "skip"],
    ["next exercise", "skip"],
    ["say again", "repeat"],
    ["my knee hurts", "pain"],
    ["ouch", "pain"],
    ["I feel dizzy", "pain"],
    ["chest tightness", "pain"],
    ["stop, it hurts", "pain"],
    ["no pain, done", "done"],
    ["عندي ألم في الركبة", "pain"],
    ["تم", "done"],
    ["ثقيل", "too_heavy"],
    ["banana", "unknown"],
    ["", "unknown"],
  ];
  for (const [text, type, reps] of cases) {
    const c = parseVoiceCommand(text);
    assert.equal(c.type, type, `${text}: ${JSON.stringify(c)}`);
    if (reps !== undefined) assert.equal((c as any).reps, reps);
  }
  // A rep count wins over "heavy" in the same reply; the heaviness is kept.
  assert.deepEqual(parseVoiceCommand("I did 6 reps but it was heavy"), { type: "reps", reps: 6, heavy: true });
});

test("the trainer's own voice is never taken as a reply", () => {
  const script = built();
  const texts = [
    ...spokenLines(script).map((l) => l.text),
    ...Object.values(SHARED_PHRASES),
  ];
  // Without the guard these lines would act: the set prompt logs one rep, the
  // safety line reports pain, "Next set." skips the rest.
  assert.deepEqual(parseVoiceCommand(script.exercises[0].setLines[0].text).type, "reps");
  assert.equal(parseVoiceCommand(VOICE_SAFETY_LINE).type, "pain");
  // Every phase the runner can be in when a clip plays.
  const { send, cmd, run, ctx } = runner();
  const states: RunnerState[] = [run.state];
  send({ type: "start" });
  states.push(run.state);
  send({ type: "prompt_done" });
  states.push(run.state);
  cmd("done");
  states.push(run.state);
  send({ type: "prompt_done" });
  states.push(run.state);
  cmd("done");
  states.push(run.state);
  cmd("pause");
  states.push(run.state);
  for (const text of texts) {
    for (const sincePlaybackMs of [0, ECHO_GRACE_MS - 1])
      assert.equal(heardReply({ transcript: text, playing: true, sincePlaybackMs, prompts: [] }), null, text);
    assert.equal(heardReply({ transcript: text, playing: false, sincePlaybackMs: 100, prompts: [] }), null, text);
    // Heard a little later as the echo of the prompt that just played.
    const late = heardReply({ transcript: text, playing: false, sincePlaybackMs: 1500, prompts: [text] });
    assert.equal(late, null, text);
    for (const state of states) {
      const heard = heardReply({ transcript: text, playing: true, sincePlaybackMs: 0, prompts: [text] });
      const [next, effects] = heard ? stepRunner(ctx, state, { type: "command", command: heard }) : [state, []];
      assert.equal(next, state, text);
      assert.deepEqual(effects, []);
    }
  }
  // A partial echo ("say pain or tap stop") is recognised too.
  assert.ok(isPromptEcho("say pain or tap stop", [VOICE_SAFETY_LINE]));
  assert.ok(isPromptEcho("set one of three eight reps", [script.exercises[0].setLines[0].text]));
  // Real replies still work once the voice has stopped.
  const prompt = script.exercises[0].setLines[0].text;
  assert.deepEqual(heardReply({ transcript: "done", playing: false, sincePlaybackMs: 1500, prompts: [prompt] }), { type: "done" });
  assert.deepEqual(heardReply({ transcript: "eight reps", playing: false, sincePlaybackMs: 20000, prompts: [prompt] }), { type: "reps", reps: 8 });
  assert.deepEqual(heardReply({ transcript: "my knee hurts", playing: false, sincePlaybackMs: 1500, prompts: [prompt] })?.type, "pain");
});

type Run = { state: RunnerState; effects: RunnerEffect[] };
function runner(rules = { tooHeavyReducePercent: 10, allowSkip: true }) {
  const script = { ...built(), rules };
  const ctx = { script, rules };
  const run: Run = { state: initialRunnerState(script), effects: [] };
  const send = (event: RunnerEvent) => {
    const [next, effects] = stepRunner(ctx, run.state, event);
    run.state = next;
    run.effects.push(...effects);
    return effects;
  };
  const cmd = (type: string, extra: object = {}) => send({ type: "command", command: { type, ...extra } as any });
  return { ctx, run, send, cmd };
}
const logs = (effects: RunnerEffect[]) => effects.filter((e) => e.type === "log_set") as Array<Extract<RunnerEffect, { type: "log_set" }>>;

test("the runner walks the whole plan: prompts, sets, rest countdown, cool-down and finish", () => {
  const { run, send, cmd, ctx } = runner();
  send({ type: "start" });
  assert.equal(run.state.phase, "intro");
  assert.deepEqual((run.effects[0] as any).items.map((i: any) => i.line), ["intro:0", "safety"]);
  send({ type: "prompt_done" });
  assert.equal(run.state.phase, "warmup");
  cmd("done");
  assert.equal(run.state.phase, "setup");
  send({ type: "prompt_done" });
  assert.equal(run.state.phase, "set");
  assert.match(runnerStatus(ctx, run.state), /Back squat, set 1 of 3: 8 reps at 60 kg/);
  send({ type: "tick", seconds: 20 });
  assert.equal(run.state.setElapsed, 20);
  const first = cmd("done");
  assert.deepEqual(logs(first)[0], { type: "log_set", exerciseIndex: 0, exercise: "Back squat", set: 1, reps: 8, loadKg: 60 });
  assert.equal(run.state.phase, "rest");
  assert.equal(run.state.restRemaining, 30);
  const ten = send({ type: "tick", seconds: 21 });
  assert.ok(ten.some((e) => e.type === "say" && e.items.some((i) => "clip" in i && i.clip === "ten_seconds")));
  const three = send({ type: "tick", seconds: 7 });
  assert.ok(three.some((e) => e.type === "say" && e.items.some((i) => "clip" in i && i.clip === "countdown")));
  const next = send({ type: "tick", seconds: 5 });
  assert.equal(run.state.phase, "set");
  assert.equal(run.state.set, 2);
  const prompt = next.find((e) => e.type === "say" && e.wait) as any;
  assert.deepEqual(prompt.items.map((i: any) => i.line ?? i.clip), ["ex:0:set:2", "ex:0:form:0"]);
  // Acknowledging the set prompt neither logs the set nor starts the rest.
  const ack = cmd("ack");
  assert.deepEqual(logs(ack), []);
  assert.ok(ack.some((e) => e.type === "say" && e.items.some((i) => "clip" in i && i.clip === "say_done")));
  assert.deepEqual(logs(cmd("resume")), []);
  assert.equal(run.state.phase, "set");
  cmd("reps", { reps: 7 });
  cmd("ack"); // "okay" during the rest does not skip it
  assert.equal(run.state.phase, "rest");
  cmd("skip"); // skip the rest
  cmd("done");
  assert.equal(run.state.phase, "rest");
  cmd("done");
  assert.equal(run.state.phase, "setup");
  assert.equal(run.state.exercise, 1);
  send({ type: "prompt_done" });
  cmd("done");
  assert.equal(run.state.phase, "cooldown");
  send({ type: "prompt_done" });
  assert.equal(run.state.phase, "finished");
  assert.ok(run.effects.some((e) => e.type === "finished"));
  const all = logs(run.effects);
  assert.deepEqual(all.map((l) => [l.exercise, l.set, l.reps, l.loadKg]), [
    ["Back squat", 1, 8, 60],
    ["Back squat", 2, 7, 60],
    ["Back squat", 3, 8, 60],
    ["Push-up", 1, 10, 0],
  ]);
  // Nothing more is logged after the plan is complete.
  cmd("done");
  assert.equal(logs(run.effects).length, 4);
});

test("too heavy lowers the next set once within the rule; the rule can forbid it", () => {
  const { run, send, cmd } = runner();
  send({ type: "start" });
  send({ type: "prompt_done" });
  cmd("done");
  send({ type: "prompt_done" });
  const adjusted = cmd("too_heavy");
  const say = adjusted.find((e) => e.type === "say") as any;
  assert.deepEqual(say.items.map((i: any) => i.clip), ["lighter", "num:54", "kilograms"]);
  assert.deepEqual(adjusted.find((e) => e.type === "outcome"), { type: "outcome", outcome: { type: "adjusted", exercise: 0, set: 1, fromKg: 60, toKg: 54 } });
  assert.deepEqual(run.state.targets[0].map((t) => t.loadKg), [54, 54, 54]);
  const again = cmd("too_heavy");
  assert.ok(again.some((e) => e.type === "outcome" && e.outcome.type === "too_heavy_kept"));
  assert.deepEqual(run.state.targets[0].map((t) => t.loadKg), [54, 54, 54]);
  assert.equal(logs(cmd("done"))[0].loadKg, 54);
  // An adjusted set is announced from shared clips, not the prescribed line.
  const upcoming = send({ type: "tick", seconds: 30 }).find((e) => e.type === "say" && e.wait) as any;
  assert.deepEqual(upcoming.items.slice(0, 5).map((i: any) => i.clip), ["next_set", "num:8", "reps", "num:54", "kilograms"]);
  const strict = runner({ tooHeavyReducePercent: 0, allowSkip: false });
  strict.send({ type: "start" });
  strict.send({ type: "prompt_done" });
  strict.cmd("done");
  strict.send({ type: "prompt_done" });
  strict.cmd("too_heavy");
  assert.equal(strict.run.state.targets[0][0].loadKg, 60);
  const skip = strict.cmd("skip");
  assert.ok(skip.some((e) => e.type === "say" && e.items.some((i) => "clip" in i && i.clip === "no_skip")));
  assert.equal(strict.run.state.phase, "set");
});

test("reps with a heavy flag are logged as said and lighten the next set; heavy after a final set is only noted", () => {
  const { run, send, cmd } = runner();
  send({ type: "start" });
  send({ type: "prompt_done" });
  cmd("done");
  send({ type: "prompt_done" });
  const effects = cmd("reps", { reps: 6, heavy: true });
  assert.deepEqual(logs(effects).map((l) => [l.set, l.reps, l.loadKg]), [[1, 6, 60]]);
  assert.ok(effects.some((e) => e.type === "outcome" && e.outcome.type === "adjusted" && e.outcome.set === 2));
  assert.deepEqual(run.state.targets[0].map((t) => t.loadKg), [60, 54, 54]);
  assert.equal(run.state.phase, "rest");
  // Final set of the exercise, then "too heavy" in the rest before the next exercise.
  const strict = runner();
  strict.send({ type: "start" });
  strict.send({ type: "prompt_done" });
  strict.cmd("done");
  strict.send({ type: "prompt_done" });
  strict.cmd("done");
  strict.send({ type: "tick", seconds: 30 });
  strict.cmd("done");
  strict.send({ type: "tick", seconds: 30 });
  strict.cmd("done"); // set 3 logged, resting before the push-up
  assert.equal(strict.run.state.phase, "rest");
  assert.equal(strict.run.state.set, 3);
  const late = strict.cmd("too_heavy");
  assert.ok(late.some((e) => e.type === "say" && e.items.some((i) => "clip" in i && i.clip === "noted")));
  assert.ok(late.some((e) => e.type === "outcome" && e.outcome.type === "too_heavy_kept" && e.outcome.exercise === 0));
  assert.ok(!late.some((e) => e.type === "outcome" && e.outcome.type === "adjusted"));
  assert.deepEqual(strict.run.state.targets[0].map((t) => t.loadKg), [60, 60, 60]);
});

test("pain stops the session from any phase and reports it; a hold stops it too", () => {
  for (const steps of [0, 1, 3, 4]) {
    const { run, send, cmd } = runner();
    const sequence: RunnerEvent[] = [
      { type: "start" },
      { type: "prompt_done" },
      { type: "command", command: { type: "done" } },
      { type: "prompt_done" },
    ];
    for (const e of sequence.slice(0, steps)) send(e);
    const effects = cmd("pain", { transcript: "my back hurts" });
    assert.equal(run.state.phase, "stopped");
    assert.equal(run.state.stopReason, "pain");
    assert.deepEqual(effects.find((e) => e.type === "report_pain"), { type: "report_pain", description: "Voice session: my back hurts" });
    assert.deepEqual(cmd("done"), []);
    assert.deepEqual(send({ type: "tick", seconds: 5 }), []);
  }
  const { run, send } = runner();
  send({ type: "start" });
  send({ type: "held" });
  assert.equal(run.state.phase, "stopped");
  assert.equal(run.state.stopReason, "hold");
});

test("pause freezes the rest timer and resume continues it; ending is explicit", () => {
  const { run, send, cmd } = runner();
  send({ type: "start" });
  send({ type: "prompt_done" });
  cmd("done");
  send({ type: "prompt_done" });
  cmd("done");
  send({ type: "tick", seconds: 10 });
  cmd("pause");
  assert.equal(run.state.phase, "paused");
  assert.equal(run.state.resume, "rest");
  send({ type: "tick", seconds: 100 });
  assert.equal(run.state.restRemaining, 20);
  cmd("resume");
  assert.equal(run.state.phase, "rest");
  assert.equal(run.state.restRemaining, 20);
  cmd("banana");
  assert.equal(run.state.phase, "rest");
  send({ type: "end" });
  assert.equal(run.state.phase, "stopped");
  assert.equal(run.state.stopReason, "member");
});

test("a default style is valid and every default line passes the wording checks", () => {
  const style = defaultVoiceStyle();
  for (const tone of ["calm", "steady", "energetic"] as const) {
    const script = buildSessionScript({ title: "t", exercises: plan, style: { ...style, tone } }).script;
    assert.deepEqual(scriptIssues(script, plan), [], tone);
  }
});
