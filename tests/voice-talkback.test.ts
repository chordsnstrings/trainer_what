// Talk-back and language in the voice chain (docs/features/voice-session.md,
// "Talk-back and language"): the spoken-reply parser in English, Modern
// Standard Arabic and Gulf Arabic, "I didn't do the last one" in the runner,
// the language each spoken line is synthesised in, the member-language choice
// of a bilingual trainer's phrases, and the Brain wording answers the model
// trial refused. Regressions use the exact transcripts of the live Cartesia
// check and the exact model answers of the trial (29 September 2026).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { clipFingerprint } from "../apps/api/src/voice-session.ts";
import { guidedAudioFingerprint } from "../apps/api/src/integrations-completion.ts";
import { speechLanguage } from "../packages/domain/src/speech-language.ts";
import {
  buildSessionScript,
  checkedSuggestions,
  planExercises,
  readVoiceSuggestions,
  scriptIssues,
  voiceStyleSchema,
  SUGGESTION_LIMITS,
  VOICE_SUGGESTION_PROMPT_VERSION,
} from "../packages/domain/src/voice-session.ts";
import {
  heardReply,
  initialRunnerState,
  parseVoiceCommand,
  replyTranscript,
  stepRunner,
  type RunnerEffect,
  type RunnerEvent,
  type RunnerState,
  type VoiceCommand,
} from "../packages/domain/src/voice-runner.ts";
import {
  generateTrainerVoice,
  withIntegrationFixtureTransport,
} from "../packages/providers/src/integrations.ts";

const plan = planExercises({
  title: "Lower body",
  exercises: [
    {
      name: "Back squat",
      sets: 3,
      reps: 8,
      loadKg: 60,
      restSeconds: 30,
      cue: "انزلي ببطء وحافظي على ظهرك مستقيما.",
    },
    { name: "Push-up", sets: 1, reps: 10, restSeconds: 0 },
  ],
});
// The model trial's bilingual trainer (T2) phrases.
const bilingual = voiceStyleSchema.parse({
  tone: "calm",
  intro: ["Welcome back, let's move gently together.", "أهلاً بك، لنبدأ بهدوء"],
  warmup: ["Breathe in, and slowly out.", "خذي نفساً عميقاً"],
  encouragement: ["You're doing beautifully.", "أحسنتِ، استمري"],
  cooldown: ["Relax your shoulders."],
  finish: ["Thank you for showing up for yourself.", "شكراً لك، يوم جميل"],
  adjustments: { tooHeavyReducePercent: 10, allowSkip: false },
});
const kind = (c: VoiceCommand) => c.type + ("reps" in c ? ":" + c.reps : "");

test("live transcripts of spoken talk-back map to the right commands (Cartesia ink-whisper, 29 September 2026)", () => {
  // What the member said -> what ink-whisper returned -> the command.
  for (const [heard, expected] of [
    ["Done. 8 reps.", { type: "reps", reps: 8 }],
    ["That was too heavy.", { type: "too_heavy" }],
    ["I didn't do the last one.", { type: "not_done", previous: true }],
    ["خلصت سويت ثمان", { type: "reps", reps: 8 }],
    ["الوزن ثقيل وايد", { type: "too_heavy" }],
    ["لم أكمل المجموعة الأخيرة", { type: "not_done", previous: true }],
    ["No pain, all good, done.", { type: "done" }],
    ["ما في ألم خلصت", { type: "done" }],
    ["ثمان تكرارات", { type: "reps", reps: 8 }],
    ["يا عورني ظهري", { type: "pain", transcript: "يا عورني ظهري" }],
  ] as const)
    assert.deepEqual(parseVoiceCommand(heard), expected, heard);
});

test("English replies: 'one' as a pronoun is not a rep count; a negated completion never logs a set", () => {
  const cases: Array<[string, string]> = [
    // Before: every one of these logged a set of 1 rep.
    ["I didn't do the last one", "not_done"],
    ["I missed the last one", "not_done"],
    ["the last one was too heavy", "too_heavy"],
    ["this one is too heavy", "too_heavy"],
    ["that one was easy", "too_easy"],
    ["next one", "resume"],
    ["the next one", "resume"],
    ["done with this one", "done"],
    ["one more", "unknown"],
    ["one more set", "unknown"],
    // Still a count.
    ["one", "reps:1"],
    ["just one", "reps:1"],
    ["one rep", "reps:1"],
    ["that was one", "reps:1"],
    ["twenty one", "reps:21"],
    // Before: "I didn't finish that set" logged the set as done.
    ["I didn't finish that set", "not_done"],
    ["I did not do the last set", "not_done"],
    ["I couldn't do it", "not_done"],
    ["didn't do it", "not_done"],
    // Still going: acknowledged, never logged, never reported.
    ["not done yet", "ack"],
    ["I'm not done", "ack"],
    ["I haven't finished", "ack"],
    ["I didn't finish yet", "ack"],
    ["almost there", "ack"],
    // Present tense "can't" stays a load complaint.
    ["I can't do it", "too_heavy"],
    ["I did it", "done"],
    ["I didn't hear you", "repeat"],
    // Polite, or the model's reading of noise: never the help line.
    ["Thank you.", "ack"],
    ["come again", "repeat"],
    // A count said with the report is logged as said.
    ["I didn't finish, did 6", "reps:6"],
  ];
  for (const [text, want] of cases) {
    const got = parseVoiceCommand(text);
    assert.equal(
      want.includes(":") ? kind(got) : got.type,
      want,
      `${text}: ${JSON.stringify(got)}`,
    );
  }
});

test("parsing keeps no state between replies", () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(
      parseVoiceCommand("I didn't finish that set").type,
      "not_done",
    );
    assert.equal(parseVoiceCommand("done").type, "done");
    assert.equal(parseVoiceCommand("ما خلصت").type, "ack");
    assert.equal(parseVoiceCommand("خلصت").type, "done");
    assert.equal(
      parseVoiceCommand("لم أكمل المجموعة الأخيرة").type,
      "not_done",
    );
  }
});

test("Arabic replies, Modern Standard and Gulf: completion, counts, effort, flow and 'not done'", () => {
  const cases: Array<[string, string]> = [
    // Not done (MSA and Gulf), said in the past.
    ["لم أكمل المجموعة الأخيرة", "not_done"],
    ["لم أقم بالمجموعة الأخيرة", "not_done"],
    ["ما سويت الأخيرة", "not_done"],
    ["ما سويتها", "not_done"],
    ["ما خلصتها", "not_done"],
    ["ما قدرت أكملها", "not_done"],
    ["ثقيل وما قدرت أكملها", "not_done"],
    ["ما خلصت الأخيرة", "not_done"],
    // Still going: never logged. Before: "ما خلصت" logged the set as done.
    ["ما خلصت", "ack"],
    ["لسا ما خلصت", "ack"],
    ["لم أنته بعد", "ack"],
    // Completion.
    ["خلصت", "done"],
    ["خلصتها", "done"],
    ["خلاص", "done"],
    ["خلصنا", "done"],
    ["تمت", "done"],
    ["انتهيت", "done"],
    ["انتهيت منها", "done"],
    ["أنهيت المجموعة", "done"],
    ["أكملت المجموعة", "done"],
    // Counts: Arabic digits and words, MSA teens and compounds, Gulf teens.
    ["سويت ٨", "reps:8"],
    ["سويت ثمان", "reps:8"],
    ["سويت ست بس", "reps:6"],
    ["ثمانية", "reps:8"],
    ["قمت بثماني تكرارات", "reps:8"],
    ["اثنا عشر", "reps:12"],
    ["ثلاثة عشر تكرار", "reps:13"],
    ["خمسة وعشرون", "reps:25"],
    ["خمسة وخمسين", "reps:55"],
    ["اثنعش", "reps:12"],
    ["عشرين كيلو", "unknown"],
    ["المجموعة الثانية", "unknown"],
    // Effort.
    ["الوزن ثقيل جداً", "too_heavy"],
    ["ثقيل وايد", "too_heavy"],
    ["واجد ثقيل", "too_heavy"],
    ["ما اقدر ارفعه", "too_heavy"],
    ["ما اقدر اكمل", "too_heavy"],
    ["مو ثقيل", "unknown"],
    ["مو ثقيل وايد", "unknown"],
    ["سهل جدا", "too_easy"],
    ["خفيف وايد", "too_easy"],
    // Flow.
    ["توقف من فضلك", "pause"],
    ["استنى شوي", "pause"],
    ["لحظة", "pause"],
    ["أعد من فضلك", "repeat"],
    ["عيد", "repeat"],
    ["مرة ثانية", "repeat"],
    ["شنو", "repeat"],
    ["ما سمعتك", "repeat"],
    ["يلا نكمل", "resume"],
    ["التالي", "resume"],
    ["التمرين التالي", "skip"],
    ["تخطى هذا التمرين", "skip"],
    ["طوفها", "skip"],
    ["زين", "ack"],
    ["تمام", "ack"],
    ["ماشي", "ack"],
    ["شكراً", "ack"],
    ["يعطيك العافية", "ack"],
  ];
  for (const [text, want] of cases) {
    const got = parseVoiceCommand(text);
    assert.equal(
      want.includes(":") ? kind(got) : got.type,
      want,
      `${text}: ${JSON.stringify(got)}`,
    );
  }
});

test("pain wins in every language; the runner's extra stops only ever add stops", () => {
  for (const text of [
    "أشعر بألم في ركبتي",
    // Modern Standard Arabic dizziness, missed before.
    "أشعر بدوار",
    "دايخ",
    "يعورني ظهري",
    "عندي غثيان",
    "بستفرغ",
    "في شي غلط",
    "انا مو زين",
    "ماني زين",
    "مو بخير",
    "احس اني مو زين",
    "I'm not okay",
    "I don't feel well",
    "I think I'm going to throw up",
    "my chest feels tight",
    "stop, it hurts",
  ])
    assert.equal(parseVoiceCommand(text).type, "pain", text);
  // Not about the member's wellbeing: no stop.
  assert.notEqual(parseVoiceCommand("الوزن مو زين").type, "pain");
  assert.equal(parseVoiceCommand("no pain, done").type, "done");
});

test("a reply transcribed in both languages: the understood one is used", () => {
  // Live pairs (member's reply language first). Arabic "ثمان تكرارات" read as
  // English was "Thank you."; English "No pain, all good, done." read as
  // Arabic was "لا يزال، كل جيد، جيد".
  assert.equal(replyTranscript(["Thank you.", "ثمان تكرارات"]), "ثمان تكرارات");
  assert.equal(
    replyTranscript(["No pain, all good, done.", "لا يزال، كل جيد، جيد"]),
    "No pain, all good, done.",
  );
  assert.equal(
    replyTranscript(['"No, I\'m not in the sleep."', "ما في ألم خلصت"]),
    "ما في ألم خلصت",
  );
  assert.equal(replyTranscript(["", "خلصت"]), "خلصت");
  assert.equal(replyTranscript(["okay", "أوكي"]), "okay");
  // Both understood: the reply language wins. This is the limit the reply
  // language choice on the runner is for: Gulf "الوزن ثقيل وايد" read as
  // English was "It wasn't the gay light." (too easy).
  assert.equal(
    replyTranscript(["It wasn't the gay light.", "الوزن ثقيل وايد"]),
    "It wasn't the gay light.",
  );
  assert.equal(
    replyTranscript(["الوزن ثقيل وايد", "It wasn't the gay light."]),
    "الوزن ثقيل وايد",
  );
});

type Run = { state: RunnerState; effects: RunnerEffect[] };
function runner(
  script = buildSessionScript({
    title: "Lower body",
    exercises: plan,
    style: bilingual,
    language: "en",
  }).script,
) {
  const ctx = { script, rules: script.rules };
  const run: Run = { state: initialRunnerState(script), effects: [] };
  const send = (event: RunnerEvent) => {
    const [next, effects] = stepRunner(ctx, run.state, event);
    run.state = next;
    run.effects.push(...effects);
    return effects;
  };
  const cmd = (command: VoiceCommand) => send({ type: "command", command });
  const say = (transcript: string) => {
    const heard = heardReply({
      transcript,
      playing: false,
      sincePlaybackMs: 5000,
      prompts: [],
    });
    assert.ok(heard, transcript);
    return cmd(heard);
  };
  // Start, warm-up, first set.
  send({ type: "start" });
  send({ type: "prompt_done" });
  cmd({ type: "done" });
  send({ type: "prompt_done" });
  assert.equal(run.state.phase, "set");
  return { ctx, run, send, cmd, say };
}
const logs = (effects: RunnerEffect[]) =>
  effects.filter((e) => e.type === "log_set");
const outcomes = (effects: RunnerEffect[]) =>
  effects.flatMap((e) => (e.type === "outcome" ? [e.outcome] : []));

test("'I didn't do the last one' logs nothing, moves nothing and tells the trainer which set", () => {
  const { run, say, send } = runner();
  // The live English sequence: done with 8 reps, too heavy, then not done.
  const logged = say("Done. 8 reps.");
  assert.deepEqual(
    logs(logged).map((e: any) => [e.set, e.reps, e.loadKg]),
    [[1, 8, 60]],
  );
  assert.equal(run.state.phase, "rest");
  const heavy = say("That was too heavy.");
  assert.deepEqual(outcomes(heavy), [
    { type: "adjusted", exercise: 0, set: 2, fromKg: 60, toKg: 54 },
  ]);
  const before = run.state;
  const noted = say("I didn't do the last one.");
  assert.equal(run.state, before, "no state change");
  assert.deepEqual(logs(noted), []);
  assert.deepEqual(outcomes(noted), [
    { type: "not_done", exercise: 0, set: 1, logged: true },
  ]);
  assert.ok(
    noted.some(
      (e) =>
        e.type === "say" &&
        e.items.some((i) => "clip" in i && i.clip === "noted"),
    ),
  );
  // The rest runs on; the next set is the lighter one.
  const next = send({ type: "tick", seconds: 30 });
  assert.equal(run.state.phase, "set");
  assert.equal(run.state.set, 2);
  assert.ok(next.some((e) => e.type === "say" && /54 kilograms/.test(e.text)));
});

test("the same sequence in Arabic, from the live Arabic transcripts", () => {
  const script = buildSessionScript({
    title: "Lower body",
    exercises: plan,
    style: bilingual,
    language: "ar",
  }).script;
  const { run, say } = runner(script);
  assert.deepEqual(
    logs(say("خلصت سويت ثمان")).map((e: any) => e.reps),
    [8],
  );
  assert.deepEqual(outcomes(say("الوزن ثقيل وايد")), [
    { type: "adjusted", exercise: 0, set: 2, fromKg: 60, toKg: 54 },
  ]);
  assert.deepEqual(outcomes(say("لم أكمل المجموعة الأخيرة")), [
    { type: "not_done", exercise: 0, set: 1, logged: true },
  ]);
  assert.equal(run.state.phase, "rest");
});

test("'not done' during a set: the current set, or the one before when the reply points back", () => {
  const { run, cmd, say } = runner();
  // Current set: nothing logged, the set stays open.
  const now = say("I couldn't do it");
  assert.deepEqual(outcomes(now), [
    { type: "not_done", exercise: 0, set: 1, logged: false },
  ]);
  assert.equal(run.state.phase, "set");
  assert.deepEqual(logs(run.effects), []);
  cmd({ type: "done" });
  cmd({ type: "resume" });
  assert.equal(run.state.set, 2);
  // "The last one" in set 2 is set 1, which was logged.
  assert.deepEqual(outcomes(say("I missed the last one")), [
    { type: "not_done", exercise: 0, set: 1, logged: true },
  ]);
  // With "too heavy" in the same reply the load rule applies as well.
  const both = say("ثقيل وما قدرت أكملها");
  assert.deepEqual(
    outcomes(both).map((o) => o.type),
    ["adjusted", "not_done"],
  );
  assert.equal(run.state.targets[0][1].loadKg, 54);
});

test("'not done' before the session starts does nothing; while paused it is noted and the pause holds", () => {
  const script = buildSessionScript({
    title: "Lower body",
    exercises: plan,
  }).script;
  const ctx = { script, rules: script.rules };
  const ready = initialRunnerState(script);
  assert.deepEqual(
    stepRunner(ctx, ready, { type: "command", command: { type: "not_done" } }),
    [ready, []],
  );
  const { run, cmd } = runner();
  cmd({ type: "pause" });
  // Paused in the first set: there is no earlier set, so it is the current one.
  const effects = cmd({ type: "not_done", previous: true });
  assert.equal(run.state.phase, "paused");
  assert.deepEqual(outcomes(effects), [
    { type: "not_done", exercise: 0, set: 1, logged: false },
  ]);
});

test("each line is synthesised in its own language", () => {
  assert.equal(speechLanguage("Set 2 of 3. 8 reps at 60 kilograms."), "en");
  assert.equal(speechLanguage("أحسنتِ، استمري"), "ar");
  assert.equal(speechLanguage("انزلي ببطء وحافظي على ظهرك مستقيما."), "ar");
  assert.equal(speechLanguage("٣ مجموعات"), "ar");
  assert.equal(speechLanguage("Back squat: انزلي ببطء وحافظي على ظهرك"), "ar");
  assert.equal(speechLanguage("Back squat, keep your chest tall: ببطء"), "en");
  assert.equal(speechLanguage("3-1-1"), "en");
  assert.equal(speechLanguage(""), "en");
});

const voiceEnv: Record<string, string> = {
  VOICE_CONTRACT_VERIFIED: "true",
  VOICE_PROVIDER: "cartesia",
  VOICE_API_KEY: "sk_car_fixture_language",
  VOICE_BASE_URL: "https://cartesia.test",
  VOICE_MODEL: "sonic-3.6",
  VOICE_PRICE_VERSION: "fixture",
  VOICE_USD_PER_1000_CHARACTERS: "0.05",
  VOICE_DAILY_USD_LIMIT: "5",
};
const savedEnv = Object.fromEntries(
  Object.keys(voiceEnv).map((k) => [k, process.env[k]]),
);
before(() => Object.assign(process.env, voiceEnv));
after(() => {
  for (const [k, v] of Object.entries(savedEnv))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

test("speech requests carry the line's language unless the caller fixes it", async () => {
  const sent: any[] = [];
  const mp3 = () =>
    new Response(
      Buffer.from("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000audio"),
      { headers: { "content-type": "audio/mpeg" } },
    );
  await withIntegrationFixtureTransport(
    async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return mp3();
    },
    async () => {
      // Before: every session and guided line was sent as English.
      await generateTrainerVoice("voice-1", "أحسنتِ، استمري", async () => {}, {
        provider: "cartesia",
      });
      await generateTrainerVoice(
        "voice-1",
        "Set 1 of 3. 8 reps.",
        async () => {},
        { provider: "cartesia", language: "ar" },
      );
      // The fixed English preview line stays English.
      await generateTrainerVoice("voice-1", "أحسنتِ", async () => {}, {
        provider: "cartesia",
        textLanguage: "en",
      });
    },
  );
  assert.deepEqual(
    sent.map((b) => b.language),
    ["ar", "en", "en"],
  );
});

test("audio made when every line was sent as English is never reused for an Arabic line", () => {
  const voice = {
    id: "voice-row",
    version: 3,
    provider: "cartesia",
    model: null,
  };
  const pricing = { model: "sonic-3.6", priceVersion: "price-1" };
  // The fingerprint before this change: voice, version, model, price, provider, text.
  const before = (text: string) =>
    createHash("sha256")
      .update(
        ["voice-row", 3, "sonic-3.6", "price-1", "cartesia", text].join("\n"),
      )
      .digest("hex");
  // English clips keep their fingerprint, so audio already made is still reused.
  assert.equal(
    clipFingerprint(voice, pricing, "Set 1 of 3. 8 reps at 60 kilograms."),
    before("Set 1 of 3. 8 reps at 60 kilograms."),
  );
  assert.notEqual(
    clipFingerprint(voice, pricing, "أحسنتِ، استمري"),
    before("أحسنتِ، استمري"),
  );
  // Guided audio: the same rule for a mostly Arabic segment.
  const guidedBefore = (text: string) =>
    createHash("sha256")
      .update(
        [
          "workout-1",
          "voice-row",
          3,
          text,
          "cartesia",
          "sonic-3.6",
          "price-1",
        ].join(":"),
      )
      .digest("hex");
  const english =
    "Back squat. 3 sets of 8 repetitions. Rest 60 seconds between sets.";
  const arabic = "سكوات خلفي. انزلي ببطء وحافظي على ظهرك مستقيما.";
  assert.equal(
    guidedAudioFingerprint("workout-1", voice, english, "sonic-3.6", "price-1"),
    guidedBefore(english),
  );
  assert.notEqual(
    guidedAudioFingerprint("workout-1", voice, arabic, "sonic-3.6", "price-1"),
    guidedBefore(arabic),
  );
});

test("a bilingual trainer's phrases follow the member's language; the script stays valid", () => {
  const english = buildSessionScript({
    title: "Lower body",
    exercises: plan,
    style: bilingual,
    language: "en",
  }).script;
  const arabic = buildSessionScript({
    title: "Lower body",
    exercises: plan,
    style: bilingual,
    language: "ar",
  }).script;
  const either = buildSessionScript({
    title: "Lower body",
    exercises: plan,
    style: bilingual,
  }).script;
  const free = (s: typeof english) =>
    [
      ...s.intro.filter((l) => l.kind === "intro"),
      ...s.warmup,
      ...s.exercises.flatMap((e) => e.encouragement),
      s.finish,
    ].map((l) => l.text);
  assert.ok(
    free(english).every((t) => speechLanguage(t) === "en"),
    free(english).join(" | "),
  );
  // The cool-down has only an English phrase: an Arabic member hears it.
  assert.ok(
    free(arabic).every((t) => speechLanguage(t) === "ar"),
    free(arabic).join(" | "),
  );
  assert.equal(arabic.cooldown[0].text, "Relax your shoulders.");
  // Without a language the trainer's phrases are all used, as before.
  assert.equal(either.intro.filter((l) => l.kind === "intro").length, 2);
  // The plan cue is the trainer's own and is spoken to both.
  assert.equal(
    english.exercises[0].cueLine?.text,
    arabic.exercises[0].cueLine?.text,
  );
  for (const s of [english, arabic, either])
    assert.deepEqual(scriptIssues(s, plan), []);
});

// The trial's raw answers for the voice wording call (task T2 is the
// bilingual trainer). Each was refused whole as "not in the expected form".
const TRIAL = {
  opusT2:
    '{"intro": ["Welcome back, let\'s move gently together.", "I\'m so glad you\'re here. Let\'s settle in and begin calmly.", "أهلاً بك، لنبدأ بهدوء.", "يسعدني وجودك اليوم، لنتحرك معاً بلطف."], "warmup": ["Breathe in, and slowly out.", "Let your body wake up gently, there\'s no rush.", "Settle into an easy rhythm and notice how you feel.", "خذي نفساً عميقاً، ثم أخرجيه ببطء.", "دعي جسمك يستيقظ بهدوء، لا داعي للعجلة."], "encouragement": ["You\'re doing beautifully.", "Lovely, steady work. Take a calm breath before you continue.", "Well done, you\'re right where you need to be.", "أحسنتِ، استمري.", "رائع، أنتِ تقومين بعمل جميل."], "cooldown": ["Let everything slow down now, nice and easy.", "Breathe slowly and let your body rest.", "Take a quiet moment to enjoy how you feel.", "لنهدأ الآن، تنفسي ببطء واسترخي.", "خذي لحظة هادئة لنفسك."], "finish": ["Thank you for showing up for yourself.", "Well done today. Rest well and be kind to yourself.", "شكراً لك، يوم جميل.", "أحسنتِ اليوم، اعتني بنفسك."]}',
  sonnetT2:
    '{"intro": ["Welcome back, I\'m glad you\'re here. Let\'s move gently together.", "Hello and welcome. Let\'s ease into this with a calm, kind pace.", "أهلاً بك، سعيدة برؤيتك. لنبدأ بهدوء ولطف", "مرحباً بعودتك، لنتحرك معاً بهدوء"], "warmup": ["Take a slow, easy breath in, and let it out gently.", "Let your body wake up gently, nothing rushed.", "Notice how you feel today, and move with kindness.", "خذي نفساً هادئاً وأخرجيه ببطء", "دعي جسمك يستيقظ بلطف"], "encouragement": ["You\'re doing beautifully, keep that calm rhythm.", "Lovely work. You should feel proud of yourself.", "Wonderful, that\'s it. You\'re doing great.", "أحسنتِ، استمري بهدوء", "عمل جميل، أنتِ تبلين بلاءً رائعاً"], "cooldown": ["Relax your shoulders and let the calm carry you.", "Let your body soften and enjoy this quiet moment.", "Nicely paced. Let everything slow down gently.", "ارخي كتفيك واستمتعي بالهدوء"], "finish": ["Thank you for showing up for yourself today.", "Be proud of how you showed up. I\'ll be glad to see you again.", "شكراً لك، يوم جميل", "أحسنتِ اليوم، أراك قريباً"]}',
  haikuT1:
    '{"suggestions":{"opening":"Welcome back. Let\'s work together today.","warmUp":["Feel your joints moving freely.","Get the blood flowing."],"encouragement":"Nice rep. That\'s the strength we\'re building.","coolDown":"Great session. Breathe and recover.","signOff":"You did the work today. See you next time."},"reason":"Suggested phrases in the trainer\'s coaching style.","evidenceIds":[],"requiresReview":true}',
  haikuT2:
    '{"intro": "Welcome back, let\'s move gently together.", "warmup": "Breathe in, and slowly out.", "encouragement": "You\'re doing great; keep going.", "cooldown": "Well done today; great effort.", "feedback": "Nice form; you\'re stronger each session."}',
  haikuT3:
    '{"wording":"You are doing great. Keep pushing forward. The next set will be even better.","script":"Voice cue for workout","emotion":"encouraging"}',
};

test("Brain wording answers the model trial refused are read leniently and still checked line by line", () => {
  assert.equal(VOICE_SUGGESTION_PROMPT_VERSION, "voice-session-suggestions-v2");
  // Opus and Sonnet, T2: five warm-up lines where four are kept.
  for (const answer of [TRIAL.opusT2, TRIAL.sonnetT2]) {
    const read = readVoiceSuggestions(JSON.parse(answer));
    assert.ok(read, answer);
    assert.equal(read!.warmup!.length, SUGGESTION_LIMITS.warmup);
    const { accepted, rejected } = checkedSuggestions(read!, bilingual);
    assert.ok(
      accepted.intro.some((t) => speechLanguage(t) === "ar"),
      "Arabic lines are kept for the trainer",
    );
    assert.ok(accepted.encouragement.length >= 3);
    assert.deepEqual(rejected, []);
  }
  // Haiku, T2: one line per kind as a plain string; "feedback" is not a kind.
  const haiku = readVoiceSuggestions(JSON.parse(TRIAL.haikuT2));
  assert.deepEqual(haiku, {
    intro: ["Welcome back, let's move gently together."],
    warmup: ["Breathe in, and slowly out."],
    encouragement: ["You're doing great; keep going."],
    cooldown: ["Well done today; great effort."],
  });
  // Haiku, T1 and T3: none of the kinds; still refused.
  assert.equal(readVoiceSuggestions(JSON.parse(TRIAL.haikuT1)), null);
  assert.equal(readVoiceSuggestions(JSON.parse(TRIAL.haikuT3)), null);
  // Nothing unsafe gets through the lenient reader.
  const risky = readVoiceSuggestions({
    intro: "Do 5 extra reps",
    encouragement: ["Push through the pain", 42, null],
    formReminders: ["Round your back"],
  });
  assert.deepEqual(risky, {
    intro: ["Do 5 extra reps"],
    encouragement: ["Push through the pain"],
  });
  const checked = checkedSuggestions(risky!, bilingual);
  assert.deepEqual(checked.accepted.intro, []);
  assert.deepEqual(checked.accepted.encouragement, []);
  assert.equal(checked.rejected.length, 2);
  for (const bad of [
    null,
    [],
    "text",
    { intro: 3 },
    { other: ["x"] },
    Object.create({ intro: ["inherited"] }),
  ])
    assert.equal(readVoiceSuggestions(bad), null, JSON.stringify(bad));
});
