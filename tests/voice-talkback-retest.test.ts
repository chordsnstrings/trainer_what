// The voice chain retest (29 September 2026, app at 270a8e0): every "App
// behaviour found" example of the talk-back trial, with the exact transcripts,
// and the whole trial as a table (docs/features/voice-session.md, "Talk-back
// safety after the retest"). The rule: a set is logged only from an
// unambiguous completion in the member's own reply language; anything
// uncertain asks again or does nothing, and never logs. Pain said in either
// language still stops the session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveSafetyPolicy, screenSafety } from "../packages/domain/src/safety-policy.ts";
import { redFlagCategories } from "../packages/domain/src/red-flags.ts";
import { buildSessionScript, planExercises } from "../packages/domain/src/voice-session.ts";
import {
  heardReply,
  initialRunnerState,
  otherReadingScreenText,
  parseVoiceCommand,
  plausibleReps,
  readingsToScreen,
  replyTranscript,
  stepRunner,
  type RunnerEffect,
  type RunnerEvent,
  type RunnerState,
  type VoiceCommand,
} from "../packages/domain/src/voice-runner.ts";
import { RETEST_READINGS, RETEST_REPLIES } from "./voice-talkback-retest-fixtures.ts";

const policy = effectiveSafetyPolicy(null);
const kind = (c: VoiceCommand | null) => (!c ? "ignored" : c.type + ("reps" in c ? ":" + c.reps : ""));

// The retest's runner: set 1 of Back Squat, 3 x 5 at 60 kg, heard 5 s after
// the set prompt ended (past the echo window).
function atSetOne(reps = 5) {
  const plan = planExercises({
    title: "Lower body strength",
    exercises: [
      { name: "Back Squat", sets: 3, reps, loadKg: 60, restSeconds: 120 },
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadKg: 50, restSeconds: 90 },
    ],
  });
  const script = buildSessionScript({ title: "Lower body strength", exercises: plan, language: "en" }).script;
  const ctx = { script, rules: script.rules };
  let state: RunnerState = initialRunnerState(script);
  let prompt = "";
  const events: RunnerEvent[] = [
    { type: "start" },
    { type: "prompt_done" },
    { type: "command", command: { type: "done" } },
    { type: "prompt_done" },
  ];
  for (const event of events) {
    const [next, effects] = stepRunner(ctx, state, event);
    state = next;
    for (const e of effects) if (e.type === "say") prompt = e.text;
  }
  assert.equal(state.phase, "set");
  return { ctx, state, prompt };
}
/** What the runner does with one reply at set 1 (a command or a transcript). */
function effectAtSetOne(reply: string | VoiceCommand, target = 5) {
  const { ctx, state, prompt } = atSetOne(target);
  const command =
    typeof reply === "string"
      ? heardReply({ transcript: reply, playing: false, sincePlaybackMs: 5000, prompts: [prompt] })
      : reply;
  if (!command) return { command, logged: null as number | null, pain: false, effects: [] as RunnerEffect[] };
  const [, effects] = stepRunner(ctx, state, { type: "command", command });
  const log = effects.find((e) => e.type === "log_set");
  return {
    command,
    logged: log && log.type === "log_set" ? log.reps : null,
    pain: effects.some((e) => e.type === "report_pain"),
    effects,
  };
}
const asksAgain = (effects: RunnerEffect[]) =>
  effects.some((e) => e.type === "say" && e.items.some((i) => "clip" in i && (i.clip === "say_done" || i.clip === "help")));
/**
 * The transcribe route's decision for one reply read in the member's reply
 * language (first) and the other (heldByScreen with the default policy):
 * "held" for pain or a red flag in any reading, "unheard" when the reply
 * reading failed or heard nothing, else the reply-language reading.
 */
function routeDecision(readings: Array<string | null>) {
  const texts = readings.map((r) => (r ?? "").trim());
  if (!texts.some(Boolean)) return readings[0] === null ? { outcome: "unheard" as const } : { outcome: "acted" as const, transcript: "" };
  for (const { transcript, screened } of readingsToScreen(texts))
    if (screenSafety(screened, policy).hold || parseVoiceCommand(screened).type === "pain")
      return { outcome: "held" as const, transcript };
  if (readings[0] === null || !texts[0]) return { outcome: "unheard" as const };
  return { outcome: "acted" as const, transcript: replyTranscript(texts) };
}
function routeAtSetOne(readings: Array<string | null>) {
  const d = routeDecision(readings);
  if (d.outcome === "unheard") return { outcome: d.outcome, logged: null, pain: false, action: "unheard" };
  if (d.outcome === "held") {
    const r = effectAtSetOne({ type: "pain", transcript: d.transcript });
    return { outcome: d.outcome, logged: r.logged, pain: r.pain, action: "pain" };
  }
  const r = effectAtSetOne(d.transcript);
  return { outcome: d.outcome, logged: r.logged, pain: r.pain, action: kind(r.command) };
}

test("retest 1: Arabic hedges never log a set, MSA and Gulf, with and without diacritics", () => {
  // Exact transcripts of "تقريباً خلصت" (almost finished): every transcriber
  // heard it right and the parser logged the set at the target.
  for (const heard of ["تقريبا خلصت", "تقريباً خلصت.", "تقريبا خلصت.", "تقريباً خلصت"]) {
    assert.equal(parseVoiceCommand(heard).type, "ack", heard);
    const r = effectAtSetOne(heard);
    assert.equal(r.logged, null, heard);
    assert.ok(asksAgain(r.effects), heard + ": the member is asked again");
  }
  for (const heard of [
    // Tanween on the letter or the alef, the alef dropped, the article form.
    "تقريبًا خلصت",
    "تقريبن خلصت",
    "خلصت تقريبا",
    "بالتقريب خلصت",
    "تقريباً ثمان",
    "تقريبا سويت عشر",
    // "يعني" (sort of), with alef maqsura, "شبه" with ta marbuta.
    "يعني خلصت",
    "يعنى خلصت",
    "خلصت يعني",
    "شبه خلصت",
    "شبة خلصتها",
    // MSA "كاد": "I almost finished", "it almost ended", about to.
    "كدتُ أنتهي",
    "كدت أكملها",
    "كادت تنتهي المجموعة",
    "أوشكت على الانتهاء",
    "على وشك أخلص",
    "قربت أخلص",
    // Maybe, I think, about, not sure.
    "يمكن خلصت",
    "أظن خلصت",
    "حوالي عشر",
    "مو متأكد خلصت",
    "ما أدري سويت ثمان",
    "باقي ثنتين",
    "سويت نصها",
    // English, mirrored: almost/nearly and other hedges.
    "almost done",
    "nearly finished",
    "almost 8",
    "about 8 reps",
    "I did around ten",
    "8 or so",
    "maybe 10",
    "I think I'm done",
    "I think that's it",
    "sort of done",
    "pretty much done",
    "I did half",
    // Transliterated.
    "taqriban khalast",
    "ya3ni khalast",
  ]) {
    const got = parseVoiceCommand(heard);
    assert.ok(!["done", "reps"].includes(got.type), `${heard}: ${JSON.stringify(got)}`);
    assert.equal(effectAtSetOne(heard).logged, null, heard);
  }
  // Past "almost" is a report for the trainer, like "I almost made it".
  assert.equal(parseVoiceCommand("كدت أكملها").type, "not_done");
  assert.equal(parseVoiceCommand("I almost made it").type, "not_done");
  // Not hedges: a plain completion and a count still log; "barely" made it.
  for (const [heard, want] of [
    ["خلصت", "done"],
    ["سويت عشر", "reps:10"],
    ["I barely made it", "done"],
    ["Done, close to failure", "done"],
    ["done, about time", "done"],
  ] as const)
    assert.equal(kind(parseVoiceCommand(heard)), want, heard);
});

test("retest 2: nothing is ever logged or acted on from the other-language reading", () => {
  // Cartesia read Gulf "طوفها" (skip it) as "طوفا" in Arabic and "2." in
  // English, and the app logged a set of 2 reps.
  assert.equal(replyTranscript(["طوفا", "2."]), "طوفا");
  const skip = routeAtSetOne(["طوفا", "2."]);
  assert.deepEqual([skip.outcome, skip.logged, skip.action], ["acted", null, "unknown"]);
  // Live pairs of the first check: the reply-language reading is used, even
  // when only the other one was understood. The member is asked again.
  for (const [readings, action] of [
    [["Thank you.", "ثمان تكرارات"], "ack"],
    [['"No, I\'m not in the sleep."', "ما في ألم خلصت"], "unknown"],
    [["okay", "أوكي"], "ack"],
    [["It wasn't the gay light.", "الوزن ثقيل وايد"], "too_easy"],
    [["Hallas.", "هلست"], "unknown"],
    [["- What's that?", "مطلوب"], "repeat"],
  ] as const) {
    assert.equal(replyTranscript([...readings]), readings[0].trim());
    const r = routeAtSetOne([...readings]);
    assert.equal(r.logged, null, readings.join(" | "));
    assert.equal(r.action, action, readings.join(" | "));
  }
  // A failed or empty reply-language reading never lets the other stand in.
  for (const readings of [["", "خلصت"], [null, "خلصت سويت ثمان"], ["", "I did 12"], [null, "Done."]]) {
    const r = routeAtSetOne(readings);
    assert.deepEqual([r.outcome, r.logged], ["unheard", null], JSON.stringify(readings));
  }
  // The reply-language reading still acts.
  assert.deepEqual(routeAtSetOne(["خلصت سويت ثمان", "Close."]).logged, 8);
  assert.deepEqual(routeAtSetOne(["Done.", "مرحبا"]).logged, 5);
  // Pain in the other reading still stops the session.
  const pain = routeAtSetOne([null, "يعورني ظهري"]);
  assert.deepEqual([pain.outcome, pain.pain], ["held", true]);
  const painEn = routeAtSetOne(["Ia ur ni vahri", "يعورني ظهري"]);
  assert.deepEqual([painEn.outcome, painEn.pain], ["held", true]);
});

test("retest 3: a number is a count only when tied to the set; implausible counts are asked again", () => {
  // "الوزن ثقيل وايد" (very heavy) misheard as "الوزن ثقيل واحد" logged a set
  // of 1 rep (gpt-4o-mini-transcribe, whisper-1).
  for (const heard of ["الوزن ثقيل واحد.", "الوزن ثقيل واحد", "ثقيل واحد", "صعب وايد واحد", "heavy one", "that was hard one", "too hard, two"]) {
    const got = parseVoiceCommand(heard);
    assert.notEqual(got.type, "reps", `${heard}: ${JSON.stringify(got)}`);
    assert.equal(effectAtSetOne(heard).logged, null, heard);
  }
  assert.equal(parseVoiceCommand("الوزن ثقيل واحد.").type, "too_heavy");
  // An effort word just before a number word wins even when a completion word
  // comes first ("خلصت، ثقيل وايد" misheard): too heavy, never 1 rep.
  for (const heard of ["خلصت، ثقيل واحد", "done, heavy two", "سويت صعب ثلاث"])
    assert.notEqual(parseVoiceCommand(heard).type, "reps", heard);
  assert.deepEqual(parseVoiceCommand("heavy, did 6 reps"), { type: "reps", reps: 6, heavy: true });
  // Other mishearings that logged a wrong number.
  for (const heard of [
    "ما خمسة", // "ما خلصت" (whisper-1)
    "ما تقدر تكمل ثلاث ست.", // "ما قدرت أكمل the last set" (gpt-transcribe, loud)
    "ما تقدر تكمل ثلاث ساعات.",
    "أعطى 12",
    "الوزن 20",
    "the weight was 20",
    "I got 2 left",
    "3 more",
  ]) {
    const got = parseVoiceCommand(heard);
    assert.notEqual(got.type, "reps", `${heard}: ${JSON.stringify(got)}`);
    assert.equal(effectAtSetOne(heard).logged, null, heard);
  }
  // "خلصت، سويت ثمان" read as "هل ست؟ سويت ثمان" logged 6: the count said
  // with "سويت" is the one.
  assert.deepEqual(parseVoiceCommand("هل ست؟ سويت ثمان"), { type: "reps", reps: 8 });
  // "سويت عشر" read as "تسعة عشر" (19): a whole-reply count, but not for a
  // set of 5 (the retest's) or of 10. Asked again, nothing logged.
  assert.deepEqual(parseVoiceCommand("تسعة عشر"), { type: "reps", reps: 19 });
  for (const target of [5, 10]) {
    const r = effectAtSetOne("تسعة عشر", target);
    assert.equal(r.logged, null, `target ${target}`);
    assert.ok(asksAgain(r.effects));
    assert.deepEqual(r.effects.map((e) => e.type), ["say"], "no outcome, no log");
  }
  // Tied counts still log as said.
  for (const [heard, reps] of [
    ["سويت عشر.", 10],
    ["خلصت، سويت ثمان.", 8],
    ["Done يا كوتش، سويت twelve.", 12],
    ["I did twelve.", 12],
    ["Eight reps.", 8],
    ["Done, ten reps at sixty kilos.", 10],
    ["I did six, it was too heavy.", 6],
    ["أكملت ثماني تكرارات.", 8],
    ["heavy, 6 reps", 6],
    ["ست بس", 6],
    ["٨", 8],
    ["Eight.", 8],
    ["okay, eight", 8],
    ["one", 1],
    ["that was one", 1],
  ] as const) {
    assert.deepEqual(kind(parseVoiceCommand(heard)), "reps:" + reps, heard);
  }
  // Plausible counts for a set: 1 to one and a half times the target or five
  // more, whichever is larger, never more than twice it; typed counts are not
  // checked.
  assert.deepEqual([0, 1, 5, 10, 11, 12].map((n) => plausibleReps(n, 5)), [false, true, true, true, false, false]);
  assert.deepEqual([1, 15, 16, 19, 20].map((n) => plausibleReps(n, 10)), [true, true, false, false, false]);
  assert.deepEqual([30, 31].map((n) => plausibleReps(n, 20)), [true, false]);
  assert.deepEqual([2, 3].map((n) => plausibleReps(n, 1)), [true, false]);
  assert.deepEqual([6, 7].map((n) => plausibleReps(n, 3)), [true, false]);
  assert.equal(effectAtSetOne({ type: "reps", reps: 19 }).logged, null, "heard");
  assert.equal(effectAtSetOne({ type: "reps", reps: 0 }).logged, null, "heard zero");
  assert.equal(effectAtSetOne({ type: "reps", reps: 19, typed: true }).logged, 19, "typed on the screen");
  assert.equal(effectAtSetOne({ type: "reps", reps: 8 }).logged, 8);
  // "6 reps but heavy" with an implausible count: nothing logged, no load change.
  const heavy = effectAtSetOne({ type: "reps", reps: 40, heavy: true });
  assert.equal(heavy.logged, null);
  assert.ok(!heavy.effects.some((e) => e.type === "outcome"));
});

test("retest 4: the other-language reading stops the session only for a pain phrase, never weakening pain", () => {
  // "I didn't finish that set." read as Arabic contained "ألم" (the question
  // particle, "didn't...?") and stopped the session for pain.
  const falseStop = "ألم أنه لا ينفع هذا المنزل";
  assert.deepEqual(redFlagCategories(otherReadingScreenText(falseStop)), []);
  const r = routeAtSetOne(["I didn't finish that set.", falseStop]);
  assert.deepEqual([r.outcome, r.pain, r.logged, r.action], ["acted", false, null, "not_done"]);
  for (const other of ["ألم تر أنه خلص", "ألم أقل لك", "ألم يكن هذا المنزل", "إلام تنظر", "إصابة الهدف سهلة"])
    assert.equal(routeAtSetOne(["Done.", other]).pain, false, other);
  // The reply-language reading is screened unchanged (conservative).
  assert.equal(routeAtSetOne([falseStop, "I didn't finish that set."]).pain, true);
  // Pain phrases in the other reading still stop it.
  for (const other of [
    "ألم",
    "ألم!",
    "آه ألم",
    "ألم ألم",
    "عندي ألم",
    "فيني ألم",
    "أحس ألم",
    "ألم في ركبتي",
    "ألم بركبتي",
    "ألم شديد",
    "الألم",
    "بألم",
    "آلام في ظهري",
    "إصابة في الكتف",
    "مي باك يعورني",
    "يعورني ظهري",
    "ظهري يعورني.",
    "أشعر بدوار.",
    "My knee hurts.",
    "I feel dizzy.",
    "My back, يعورني.",
  ]) {
    const got = routeAtSetOne(["It was fine.", other]);
    assert.deepEqual([got.outcome, got.pain], ["held", true], other);
  }
  // Code-switched pain and its Latin transliteration stop the session, read
  // once (every OpenAI model) or as the reply-language reading.
  for (const heard of [
    "My back يعورني.",
    "My back yawrni.",
    "My back yaourni.",
    "My back, yaourni.",
    "My back yaurni.",
    "My back, yaurni.",
    "My back, yaurne.",
    "Mai back iauurni.",
    "Mai back yauri.",
    "My back yawni.",
    "My back y3awrni",
    "rukbati tooja3ni",
    // "تعبان" in an unwell phrase (review VT-R8): bare "تعبان" is "tired".
    "ana ta3ban marra",
    "a7es inni ta3ban",
    "انا تعبان مرة",
    "حاس اني تعبان",
    "تعبانة وايد",
  ]) {
    assert.equal(parseVoiceCommand(heard).type, "pain", heard);
    assert.deepEqual(routeAtSetOne([heard, "مي باك"]).pain, true, heard);
  }
  // Not pain: English words and negated forms.
  for (const heard of ["My back yawned.", "mu ta3ban", "مو تعبان", "ماني تعبان", "I'm tired", "تعبت", "yarn", "your turn"])
    assert.notEqual(parseVoiceCommand(heard).type, "pain", heard);
});

test("retest 5 and 6: transliterated Gulf terms; 'خلص' and 'خلاص' alone are not completions", () => {
  for (const [heard, want] of [
    // "سويت twelve" became "So wait, twelve": a pause, never a log.
    ["So wait, twelve", "pause"],
    ["sawwait 12", "reps:12"],
    ["sawait twelve", "reps:12"],
    ["khalast", "done"],
    ["5alast", "done"],
    ["khalast, sawwait 8", "reps:8"],
    ["khalasna", "done"],
    ["kammalt", "done"],
    ["sawwaitha", "done"],
    ["ma khalast", "ack"],
    ["ma sawwaitha", "not_done"],
    // Trainer decision: "خلاص" also means "stop" or "enough", and a hurried
    // "خلص" (gpt-transcribe) may be anything. The member hears the help line.
    ["خلص", "unknown"],
    ["خلاص", "unknown"],
    ["khalas", "unknown"],
    ["Hallas.", "unknown"],
    // With a real completion or a count they are fine.
    ["خلاص خلصت", "done"],
    ["ثمان خلاص", "reps:8"],
    // "Not finished" is still a negated completion.
    ["مو خلاص", "ack"],
  ] as const)
    assert.equal(kind(parseVoiceCommand(heard)), want, heard);
  for (const heard of ["خلص", "خلاص"]) {
    const r = effectAtSetOne(heard);
    assert.equal(r.logged, null, heard);
    assert.ok(asksAgain(r.effects), heard);
  }
});

test("a completion still to come or asked about never logs: 'I need to finish', 'am I done?'", () => {
  // Found while checking the rule on English: each of these logged the set.
  for (const heard of [
    "I need to finish",
    "I have to complete 8",
    "let me finish",
    "I'm going to finish",
    "gonna finish this",
    "I want to finish",
    "I'll finish",
    "about to finish",
    "trying to finish",
    "I will be done soon",
    "done soon",
    "done in a sec",
    "am I done?",
    "are we done",
    "is it finished?",
  ]) {
    // Still going: an acknowledgement, and during a set the member is asked again.
    assert.equal(parseVoiceCommand(heard).type, "ack", heard);
    const r = effectAtSetOne(heard);
    assert.equal(r.logged, null, heard);
    assert.ok(asksAgain(r.effects), heard);
  }
  for (const [heard, want] of [
    ["done", "done"],
    ["I'm done", "done"],
    ["I'm done, I'll do the next one", "done"],
    ["done, let's go", "done"],
    ["let's do it", "unknown"],
    // "Reps" written in Arabic letters by the transcriber.
    ["8 ربز", "reps:8"],
    ["10 ربز في 60 كيلوز", "reps:10"],
    ["حلصت، ساويت ثمان", "reps:8"],
    // Digits written into a word are not a number ("5alast" is "خلصت").
    ["5alast", "done"],
    ["3ashara", "unknown"],
  ] as const)
    assert.equal(kind(parseVoiceCommand(heard)), want, heard);
});

test("all 40 talk-back scripts of the retest: no unsafe log, pain stops, the right action", () => {
  assert.equal(RETEST_REPLIES.length, 40);
  for (const reply of RETEST_REPLIES) {
    const completion = reply.expect.some((e) => e === "done" || e.startsWith("reps:"));
    const expected = reply.expect.find((e) => e.startsWith("reps:"));
    // The exact script text as heard, in the member's reply language, at set
    // 1 of the retest's 3 x 5 and of a 3 x 10.
    const r = effectAtSetOne(reply.text);
    const action = kind(r.command);
    assert.ok(reply.expect.includes(action), `${reply.id} ${reply.text}: ${action}`);
    const count = expected ? Number(expected.slice(5)) : 5;
    if (!completion) assert.equal(r.logged, null, `${reply.id} ${reply.text}: unsafe log`);
    else if (plausibleReps(count, 5)) assert.equal(r.logged, count, `${reply.id} ${reply.text}`);
    else {
      // "I did twelve" for a set of 5 (more than twice): asked again.
      assert.equal(r.logged, null, `${reply.id} ${reply.text}: implausible for 5`);
      assert.ok(asksAgain(r.effects), `${reply.id} ${reply.text}`);
    }
    assert.equal(effectAtSetOne(reply.text, 10).logged, completion ? (expected ? count : 10) : null, `${reply.id} at 10`);
    assert.equal(r.pain, reply.expect.includes("pain"), `${reply.id} ${reply.text}`);
    // Through the route with the script as the reply-language reading and the
    // same words as the other reading, and with the reply reading failing.
    const route = routeAtSetOne([reply.text, reply.text]);
    assert.equal(route.pain, reply.expect.includes("pain"), `${reply.id} route`);
    if (!completion) assert.equal(route.logged, null, `${reply.id} route: unsafe log`);
    const failed = routeAtSetOne([null, reply.text]);
    assert.equal(failed.logged, null, `${reply.id}: logged from the other reading`);
    assert.equal(failed.pain, reply.expect.includes("pain"), `${reply.id}: pain in the other reading`);
  }
});

test("every transcription of the retest (1,080 results): no unsafe log, no false stop, pain missed only where unreadable", () => {
  const byId = new Map(RETEST_REPLIES.map((r) => [r.id, r]));
  let results = 0;
  const missed: string[] = [];
  for (const { id, readings, results: n } of RETEST_READINGS) {
    results += n;
    const reply = byId.get(id)!;
    const completion = reply.expect.some((e) => e === "done" || e.startsWith("reps:"));
    const r = routeAtSetOne(readings);
    const label = `${id} ${JSON.stringify(readings)} -> ${r.action}`;
    if (!completion) assert.equal(r.logged, null, "unsafe log: " + label);
    const expected = reply.expect.find((e) => e.startsWith("reps:"));
    // A logged count is the one said, or the target for a plain "done".
    if (r.logged !== null && expected && r.action.startsWith("reps:"))
      assert.equal(r.logged, Number(expected.slice(5)), "wrong count: " + label);
    if (!reply.expect.includes("pain")) assert.equal(r.pain, false, "false stop: " + label);
    else if (!r.pain) missed.push(readings.map((x) => x ?? "(failed)").join(" | "));
    // Read twice through the route, no pain report is missed.
    if (readings.length === 2 && reply.expect.includes("pain")) assert.ok(r.pain, "missed pain: " + label);
  }
  assert.equal(results, 1080);
  // Single readings that carry no pain word in any script (garbled, Cyrillic,
  // or real English words): only a second reading can catch these.
  assert.deepEqual(missed.sort(), [
    "Ashwali bidiwah.",
    "Mai back iaw rni.",
    "My back yawned at me.",
    "My back yawned.",
    "My back ya ur me.",
    "My back,",
    "My back?",
    "My back? Ya, aur mein?",
    "My back? Yeah, I would admit it.",
    "My back? Yeah, I wouldn't make it.",
    "Мой бак, я урни.",
    "Мой бак? Я ору.",
    "أشوري بدوا",
    "البحر يعورم",
  ].sort());
});

// ---------------------------------------------------------------------------
// Review of the retest fixes (VT-R1 to VT-R9): paraphrase tables per rule,
// each asserted at the runner (set 1 of 3 x 5, and of 3 x 10): nothing is
// logged, or exactly the count said.
// ---------------------------------------------------------------------------
/** Asserts that none of `replies` logs a set or stops the session, at a set of 5 and of 10. */
function neverLogs(replies: string[], label: string) {
  for (const reply of replies)
    for (const target of [5, 10]) {
      const r = effectAtSetOne(reply, target);
      assert.equal(r.logged, null, `${label}: "${reply}" at ${target} logged (${JSON.stringify(r.command)})`);
      assert.equal(r.pain, false, `${label}: "${reply}" stopped the session`);
    }
}
const asksAgainAt = (reply: string) => asksAgain(effectAtSetOne(reply).effects);

test("review VT-R1: every Arabic hedge, bare or with the conjunction و / ف joined, never logs", () => {
  const hedges = [
    "تقريبا", "تقريباً", "تقريبًا", "بالتقريب", "يعني", "يعنى", "شبه", "كدت", "قربت", "يمكن", "ممكن", "ربما",
    "احتمال", "أظن", "أعتقد", "أتوقع", "حوالي", "بحدود", "نص", "نصف", "باقي", "مو متأكد", "ما أدري", "مدري",
  ];
  const replies: string[] = [];
  for (const hedge of hedges)
    for (const prefix of ["", "و", "ف"]) {
      const h = prefix + hedge;
      replies.push(`${h} خلصت`, `خلصت ${h}`, `${h} سويت ثمان`, `سويت ثمان ${h}`);
    }
  neverLogs(replies, "hedge");
  // The retest review's exact forms, and the member is asked again.
  for (const reply of ["وتقريبا خلصت", "وتقريباً خلصت", "ويمكن خلصت", "وشبه خلصت", "ويعني خلصت", "خلصت وتقريبا", "خلصت وباقي ثنتين", "خلصت وباقي وحدة", "فيمكن خلصت", "خلصت، باقي 2"]) {
    assert.equal(parseVoiceCommand(reply).type, "ack", reply);
    assert.ok(asksAgainAt(reply), reply);
  }
  // A hedged count asks again rather than earning the help line.
  for (const reply of ["حوالي عشر", "تقريباً ثمان", "almost 8", "maybe 10", "8 or so", "I did around ten"])
    assert.equal(parseVoiceCommand(reply).type, "ack", reply);
  // Not hedges: "من فضلك" (please) and a plain completion or count still log.
  for (const [reply, logged] of [["خلصت", 5], ["من فضلك خلصت", 5], ["خلصت، من فضل", 5], ["سويت ثمان", 8], ["خلصت، باقي مجموعتين", 5]] as const)
    assert.equal(effectAtSetOne(reply).logged, logged, reply);
});

test("review VT-R3: a reply that says reps were missed or are left never logs them or the target", () => {
  neverLogs(
    [
      // English: except, minus, short, missing, without, to go, left, didn't get, failed.
      "done except 2", "done, missing 2", "done, 2 short", "done, 2 to go", "just 2 to go", "done except the last two",
      "done, didn't get the last rep", "did 10 but missed 1", "did 10 minus 1", "done, 2 left", "done, 2 reps left",
      "done, one rep short", "done, short by one", "done, failed the last rep", "done without the last two",
      "done, couldn't get the last one", "done, 2 remaining", "I did 8, 2 more to go", "done, missing one",
      "done minus one", "finished except one", "done, a couple short", "I've done 8 more.",
      // Arabic: الا، ناقص، بدون، ما عدا، غير، بقى، ضل، فاتني، "بس N وأخلص / بعد".
      "خلصت الا 2", "خلصت الا وحدة", "خلصت إلا وحدة", "خلصت بدون ثنتين", "خلصت بدون آخر وحدة", "بس ثنتين وأخلص",
      "بس ثنتين بعد", "ثنتين بعد", "خلصت وبقى ثنتين", "خلصت بقي ثنتين", "خلصت، ضل ثنتين", "خلصت وضل وحدة",
      "خلصت ناقص وحدة", "خلصت ناقصني وحدة", "خلصت ما عدا وحدة", "خلصت عدا ثنتين", "خلصت غير وحدة",
      "خلصت بس فاتتني وحدة", "خلصت فاتني ثنتين", "سويت عشر الا وحده", "سويت ثمان وباقي ثنتين", "باقي لي ثنتين",
      "ثنتين وبخلص",
    ],
    "deficit",
  );
  // Asked again (not the help line): the member can say the count.
  for (const reply of ["done except 2", "خلصت الا وحدة", "just 2 to go", "بس ثنتين وأخلص", "did 10 but missed 1", "سويت عشر الا وحده"]) {
    assert.equal(parseVoiceCommand(reply).type, "ack", reply);
    assert.ok(asksAgainAt(reply), reply);
  }
  // Said as a report of a missed set it is still "not done".
  assert.equal(parseVoiceCommand("I missed 3 reps").type, "not_done");
  // A count said after the deficit, in its own clause, is what was done.
  for (const [reply, logged] of [
    ["missing 2, did 3", 3],
    ["خلصت الا وحدة، سويت أربع", 4],
    ["I didn't do the last one, 8 reps", 8],
    // Not deficits: "after the rest", the side of unilateral work.
    ["سويت ثمان بعد الراحة", 8],
    ["done, 8 reps left side", 8],
  ] as const)
    assert.equal(effectAtSetOne(reply).logged, logged, reply);
  // Sets still to do are not reps: a completion stays one.
  for (const reply of ["done, 2 more sets", "done, one more set to go", "خلصت، باقي مجموعتين", "خلصت بدون راحة", "done, 2 sets left"])
    assert.equal(effectAtSetOne(reply).logged, 5, reply);
  // The tie between a completion word and a count allows only fillers.
  for (const [reply, reps] of [["did all 8", 8], ["did them all 8", 8], ["خلصت يا كوتش ثمان", 8], ["done coach 8", 8]] as const)
    assert.deepEqual(parseVoiceCommand(reply), { type: "reps", reps }, reply);
});

test("review VT-R4: a set, exercise or position number is never a rep count", () => {
  for (const reply of [
    "خلصت المجموعة 2", "خلصت المجموعه 2", "خلصت بالمجموعة 2", "خلصت التمرين 2", "خلصت الست 2", "خلصت السيت 2",
    "خلصت الجولة 2", "خلصت رقم 2", "خلصت ٢ من ٣", "done, 2 of 3", "finished 1 of 3", "done 1/3", "done, 2 out of 3",
    "done with set 2", "set 2 done", "done, exercise 1", "خلصت المجموعة 1 من 3",
    // The completion word after the number would tie it: still a set.
    "المجموعة 2 خلصت", "التمرين 2 خلصت", "رقم 2 خلصت", "الست 2 خلصت", "بالمجموعة 2 خلصت",
  ]) {
    // "Done" logs the target; the number is never the count.
    for (const target of [5, 10]) assert.equal(effectAtSetOne(reply, target).logged, target, `${reply} at ${target}`);
    assert.equal(parseVoiceCommand(reply).type, "done", reply);
  }
  // Without a completion word a position alone logs nothing.
  neverLogs(["2 of 3", "المجموعة 2", "8 out of 10"], "position");
});

test("review VT-R5: a number just after an effort word is not a count, in digits too", () => {
  for (const reply of [
    "الوزن ثقيل 1", "خلصت، ثقيل 1", "done, heavy 1", "did heavy 2", "heavy 1", "صعب 2", "that was hard 1", "خلصت صعب ٢",
    // A word after the number that would tie it ("done", "خلاص", "بس").
    "heavy 1 done", "ثقيل 1 خلاص", "صعب 2 بس", "ثقيل وايد 1 خلصت",
  ]) {
    const got = parseVoiceCommand(reply);
    assert.notEqual(got.type, "reps", `${reply}: ${JSON.stringify(got)}`);
    const r = effectAtSetOne(reply);
    assert.equal(r.logged, null, reply);
    assert.ok(!r.effects.some((e) => e.type === "outcome" && e.outcome.type === "too_heavy_kept" && e.outcome.reps === 1), reply);
  }
  // With a rep word, or reported, the count stands with the heavy flag.
  assert.deepEqual(parseVoiceCommand("heavy, 6 reps"), { type: "reps", reps: 6, heavy: true });
  assert.deepEqual(parseVoiceCommand("heavy, did 6"), { type: "reps", reps: 6, heavy: true });
  assert.deepEqual(parseVoiceCommand("ثقيل، سويت 6"), { type: "reps", reps: 6, heavy: true });
});

test("review VT-R6: a range or a corrected count is asked again", () => {
  const replies = [
    "did 8 or 9", "سويت ثمان أو تسع", "سويت ثمان او تسع", "did 8, no, 6", "did 8, actually 6", "سويت ثمان، قصدي ست",
    "سويت عشر، لا ثمان", "I did 12 I mean 10", "did 8 to 10", "did between 8 and 10", "8 or 9 reps", "did 8, sorry, 6",
    "سويت ثمان وتسع", "did 8, did 6", "8 9 10 done", "سويت بين ثمان وعشر",
  ];
  neverLogs(replies, "range or correction");
  for (const reply of ["did 8 or 9", "سويت عشر، لا ثمان", "I did 12 I mean 10", "did 8, actually 6"]) {
    assert.equal(parseVoiceCommand(reply).type, "ack", reply);
    assert.ok(asksAgainAt(reply), reply);
  }
  // One count, said twice or with a load, stands.
  for (const [reply, logged] of [
    ["did 8, 8 reps", 8],
    ["Done, ten reps at sixty kilos.", 10],
    ["10 ربز في 60 كيلوز", 10],
    ["هل ست؟ سويت ثمان", 8],
    ["no pain, did 8", 8],
    ["لا، سويت ثمان", 8],
  ] as const)
    assert.equal(effectAtSetOne(reply, 10).logged, logged, reply);
});

test("review VT-R7: English synonyms of 'almost done', hopes and 'N more and done' never log", () => {
  neverLogs(
    [
      "just about done", "I'm about done", "about done", "close to done", "close to finished", "all but done",
      "practically done", "virtually done", "basically done", "essentially done", "technically done", "done-ish",
      "done ish", "8-ish", "done I hope", "hopefully done", "should be done", "that should be it", "must be done",
      "as good as done", "3 more and done", "one more and done", "two more then done", "2 more to go",
      "about there", "just about finished", "I reckon I'm done",
    ],
    "synonym",
  );
  // Not hedges: "about time", "close to failure", "barely", and a hope or
  // "should be" about the load (feedback).
  for (const reply of [
    "done, about time", "Done, close to failure", "I barely made it", "done, 2 more sets",
    "done, the next set should be lighter", "done, hopefully the next one is lighter", "Done. I hope that's okay.",
  ])
    assert.equal(effectAtSetOne(reply).logged, 5, reply);
});

test("review VT-R2: pain said in Arabic in the other reading stops the session in every position", () => {
  // Each stopped the session at 0c9569d and not on the first fix (an
  // English-reply member reporting pain in Arabic: only the Arabic reading
  // can catch it).
  for (const other of [
    "ألم رهيب", "ألم خفيف", "ألم كثير", "ظهري ألم", "ركبتي ألم", "ألم، وقف", "ألم وقف", "ألم stop", "ألم مفاجئ",
    "ألم قاعد يزيد", "ألم مو طبيعي", "إصابة خفيفة", "ألم يزيد", "ألم تحت الركبة", "ألم ينزل لرجلي", "ألم يا كوتش",
    "ألم اليوم", "ألم انا", "آلام", "آلام قوية", "إصابة", "إصابة بالركبة", "عندي إصابة", "ألم أحس فيه",
    "ألم في الظهر", "ألم شديد", "ألم يمين", "ألم يدي",
  ]) {
    const got = routeAtSetOne(["It was fine.", other]);
    assert.deepEqual([got.outcome, got.pain], ["held", true], other);
  }
  // Only the question particle (followed by "أنّ" or an imperfect verb, no
  // pain context) and "إصابة الهدف" are dropped.
  for (const other of ["ألم أنه لا ينفع هذا المنزل", "ألم تر أنه خلص", "ألم أقل لك", "ألم يكن هذا المنزل", "إلام تنظر", "إصابة الهدف سهلة", "ألم تسمع", "ألم نقل"]) {
    const got = routeAtSetOne(["Done.", other]);
    assert.deepEqual([got.outcome, got.pain], ["acted", false], other);
  }
  // The question particle with a pain context is kept.
  for (const other of ["ألم يكن ظهري يوجعني", "ألم تر ركبتي"])
    assert.equal(routeAtSetOne(["Done.", other]).pain, true, other);
  assert.equal(otherReadingScreenText("ألم رهيب"), "الم رهيب");
});

test("review VT-R8: bare 'تعبان' (tired) and the name 'Alam' do not stop; unwell phrases do", () => {
  for (const reply of [
    "خلصت بس تعبان", "سويت عشر بس تعبان", "تعبان شوي", "والله تعبان", "تعبان", "انا تعبان", "تعبانة", "ana ta3ban",
    "I'm ta3baan", "Done, coach Alam", "Thanks Alam", "Done, Mr Alam", "مو وايد تعبان", "مو تعبان مرة",
    "ما احس اني تعبان", "رجولي تعبانة",
  ])
    assert.notEqual(parseVoiceCommand(reply).type, "pain", reply);
  // At the runner the rest of the reply is read as usual.
  assert.equal(effectAtSetOne("خلصت بس تعبان").logged, 5);
  assert.equal(effectAtSetOne("سويت عشر بس تعبان", 10).logged, 10);
  assert.ok(effectAtSetOne("تعبان").effects.some((e) => e.type === "say" && /pain/.test(e.text)), "the help line names pain");
  for (const reply of [
    "تعبان مرة", "تعبان وايد", "مرة تعبان", "حيل تعبان", "حاس اني تعبان", "أحس إني تعبان", "احس اني شوي تعبان",
    "أشعر أنني تعبانة", "ركبتي تعبانة", "ظهري تعبان", "انا مريض", "حاس اني مريض", "مرضان", "ta3ban marra",
    "a7es inni ta3ban", "alam", "Alam!", "ah alam", "3indi alam", "alam fi rukbati", "my back alam", "My back, alam.",
  ]) {
    assert.equal(parseVoiceCommand(reply).type, "pain", reply);
    assert.equal(effectAtSetOne(reply).pain, true, reply);
  }
});
