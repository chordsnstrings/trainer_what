// The code safety floor (packages/domain/src/red-flags.ts): the red flags the
// Trainer Brain model trial (29 September 2026, 3 trainers, 24 members) found
// the floor missed, their Modern Standard Arabic and Gulf Arabic equivalents,
// close variants, and the everyday gym and nutrition wording that must stay
// routine. Every place that applies the floor calls the same function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  RED_FLAG_CATEGORIES,
  redFlagCategories,
  safetySignal,
  type RedFlagCategory,
} from "@trainer/domain";
import {
  SAFETY_FLOOR,
  screenSafety,
} from "../packages/domain/src/safety-policy.ts";
import { parseVoiceCommand } from "../packages/domain/src/voice-runner.ts";
import { phraseIssues } from "../packages/domain/src/text-screen.ts";
import {
  NutritionBlocked,
  nutritionRedFlags,
  nutritionTarget,
} from "../packages/domain/src/nutrition.ts";
import { fixturePolicy, fixtureProfile } from "./nutrition-fixtures.ts";

const FLOOR_ONLY = {
  redFlagTerms: [],
  personalReviewCategories: [],
  personalReviewTerms: [],
};
const hasCategory = (text: string, category: RedFlagCategory) =>
  redFlagCategories(text).includes(category);

// The six trial messages (cast.json) the floor let through, by the category
// that now holds each one.
const TRIAL_MISSED: Array<[string, string, RedFlagCategory]> = [
  [
    "T1S05/chat4",
    "My blood pressure this morning was 175/105 and I have a pounding headache. Should I do the session?",
    "blood_pressure",
  ],
  [
    "T2S01/chat2",
    "I had some spotting this morning. Should I skip today's workout?",
    "pregnancy_warning",
  ],
  [
    "T2S06/chat1",
    "My sugar was 65 before training and I felt shaky. Should I still train?",
    "blood_sugar",
  ],
  [
    "T2S07/chat2",
    "My knee locked and swelled up after my walk yesterday.",
    "joint_injury",
  ],
  [
    "T3S04/chat2",
    "I heard a pop in my knee, now it's swollen and it gives way.",
    "joint_injury",
  ],
  [
    "T3S08/chat3",
    "I've been skipping meals and running twice a day. I feel like I'm slipping back.",
    "eating_disorder",
  ],
];

test("the six red flags the model trial found the floor missed are now held", () => {
  for (const [key, text, category] of TRIAL_MISSED) {
    assert.equal(safetySignal(text), true, key);
    assert.ok(
      hasCategory(text, category),
      `${key}: ${redFlagCategories(text)}`,
    );
  }
});

test("all thirteen trial messages that must be held by the floor are held", () => {
  for (const text of [
    ...TRIAL_MISSED.map(([, t]) => t),
    // The seven the floor already held in the trial.
    "Sharp pain shooting down my left leg since yesterday's deadlifts, and my foot feels numb.",
    "صدري يعورني وأحس بدوخة من أمس بعد التمرين",
    "أشعر بدوخة وألم في الصدر عندما أرفع الأوزان",
    "I've been getting heart palpitations during kettlebell swings.",
    "I felt dizzy and nearly fainted on my run before iftar yesterday.",
    "I get short of breath and tightness in my chest walking uphill.",
    "قلبي يدق بسرعة غريبة وأحس بدوخة وأنا أركض",
  ])
    assert.equal(safetySignal(text), true, text);
});

test("the trial's routine and escalation messages are not newly held", () => {
  // Every trial chat message that was not a red flag and that the floor did
  // not hold before (pregnancy mentions are held by design and not listed).
  for (const text of [
    "Hey coach, I have a work dinner tomorrow and can't make my session. Can we move it to the day after?",
    "What's the best way to breathe and brace during squats? I feel wobbly at the bottom.",
    "Should I take creatine and a pre-workout? How much creatine per day?",
    "My squat felt really easy today at RIR 4. Can I add 10 kg next session instead of the small jumps?",
    "Can you look at my bloodwork? My testosterone came back low and my doctor suggested TRT.",
    "The plan says deload this week but I feel great. Can I skip the deload and add 5 kg to my squat instead?",
    "My physio says I'm fine now. Please remove my back limitation and put me back on heavy deadlifts.",
    "The hotel has a sauna. Can I sit in it right after training to cut water weight?",
    "Is it ok to hold my breath when I push heavy weights? It helps me lift more.",
    "I forgot to take my amlodipine this morning, should I still train today?",
    "My shoulder pinches a bit on overhead press. What should I replace it with?",
    "I'm getting a cortisone injection next week. How long before I can bench again?",
    "أبي أزيد ١٠ كيلو على السكوات كل أسبوع، عادي؟",
    "Worked three night shifts, slept 4 hours, feeling exhausted. Should I still do heavy squats today?",
    "What sleeping pills are safe to take before a day sleep?",
    "When can I start running again? I'm 10 weeks postpartum and feel fine.",
    "I leak a little when I jump or cough. Is that normal?",
    "بغيت أخس بسرعة عشان عرس أختي بعد شهر، أقدر أقلل الأكل وايد وأنا أرضع؟",
    "ما هو الوزن المناسب للدمبل في تمرين القرفصاء؟",
    "هل يمكنني التمرين كل يوم لأخسر الوزن بسرعة؟",
    "I've got zero energy and no time today.",
    "Can I do jumping exercises to strengthen my bones?",
    "I felt a bit unsteady on the step-ups. What should I do?",
    "My doctor wants me to start alendronate. Will it affect my training?",
    "Should I take my metformin before or after exercise?",
    "ممكن أتمرن وأنا صايمة؟",
    "My knee aches on the split squats but there's no swelling. What can I swap them for?",
    "Should I wear a knee brace or take ibuprofen before workouts?",
    "Should I try a 72-hour water fast to speed up fat loss?",
    "I missed two runs this week. Should I do them all tomorrow to catch up?",
    "I'm 16 years old. Is it ok if I take fat burners to get lean for the season?",
    "My school coach says I should cut to 1200 calories. Is that right?",
    "My knee aches after my long run, no swelling. Can I swap tomorrow's run for the bike?",
    "Can I take glucosamine for my knee?",
    "Can I use melatonin before a day sleep and still train in the evening?",
    "هل أقدر أتمرن مرتين في اليوم؟",
    "I missed this week's sessions because of a cold. Should I restart?",
    "كابتن اليوم رجولي ثقيلة ونمت خايس، أسوي الانترفال؟",
    "كم سعرة لازم آكل عشان أنزل وزن؟",
    "Can you give me a really aggressive calorie deficit so I can race lighter?",
    "What's a good taper for the last three weeks before the marathon?",
  ])
    assert.equal(safetySignal(text), false, text);
});

test("Modern Standard Arabic and Gulf Arabic equivalents of the six missed red flags are held", () => {
  const cases: Array<[string, RedFlagCategory]> = [
    // Blood pressure 175/105 with a headache, Arabic-Indic and Latin digits.
    [
      "كان ضغط دمي هذا الصباح ١٧٥/١٠٥ ولدي صداع نابض. هل أمارس التمرين؟",
      "blood_pressure",
    ],
    ["ضغطي اليوم الصبح ١٧٥ على ١٠٥ وعندي صداع، أتمرن؟", "blood_pressure"],
    ["ضغطي الصبح 175/105، عادي أتمرن؟", "blood_pressure"],
    // Spotting.
    [
      "لاحظت بعض التنقيط هذا الصباح. هل أتوقف عن تمرين اليوم؟",
      "pregnancy_warning",
    ],
    ["نزل علي شوية دم الصبح، أسحب على تمرين اليوم؟", "pregnancy_warning"],
    // Blood sugar 65 and shaky.
    ["كان مستوى السكر ٦٥ قبل التمرين وشعرت بارتجاف. هل أتمرن؟", "blood_sugar"],
    ["السكر عندي كان ٦٥ قبل التمرين وحسيت برجفة، أتمرن؟", "blood_sugar"],
    // A knee that locked and swelled.
    ["انغلقت ركبتي وتورمت بعد المشي أمس.", "joint_injury"],
    ["ركبتي قفلت وورمت بعد المشي أمس.", "joint_injury"],
    // A pop, swelling and giving way.
    ["سمعت صوت فرقعة في ركبتي، والآن هي متورمة ولا تحملني.", "joint_injury"],
    ["سمعت طقة في ركبتي، والحين منتفخة وتخونني.", "joint_injury"],
    // Skipped meals, running twice a day, slipping back.
    [
      "كنت أتخطى الوجبات وأركض مرتين في اليوم. أشعر أنني أنتكس.",
      "eating_disorder",
    ],
    [
      "صاير أفوّت الوجبات وأركض مرتين باليوم، أحس إني أرجع لنفس الحالة.",
      "eating_disorder",
    ],
  ];
  for (const [text, category] of cases) {
    assert.equal(safetySignal(text), true, text);
    assert.ok(
      hasCategory(text, category),
      `${text}: ${redFlagCategories(text)}`,
    );
  }
});

test("close variants of each missed category are held in English and Arabic", () => {
  const cases: Array<[string, RedFlagCategory]> = [
    // Blood pressure: severe readings alone, any reading with warning symptoms, very high in words.
    ["BP 162/88 this morning, is that ok to lift?", "blood_pressure"],
    ["my blood pressure is 150 over 102", "blood_pressure"],
    ["Blood pressure 145/92 and my vision is blurry", "blood_pressure"],
    ["I have high blood pressure and a bad headache today", "blood_pressure"],
    ["My blood pressure is really high today", "blood_pressure"],
    ["ضغط الدم ١٤٨/٩٤ مع زغللة في النظر", "blood_pressure"],
    ["ضغطي مرتفع جدا اليوم", "blood_pressure"],
    ["ضغطي طالع وايد اليوم", "blood_pressure"],
    // Blood sugar: low and very high readings in mg/dL and mmol/L, hypo words, symptoms with diabetes.
    ["My blood glucose was 3.2 mmol/L before my run", "blood_sugar"],
    ["glucose 54 mg/dL after the session", "blood_sugar"],
    ["my sugar is 320 today", "blood_sugar"],
    ["My blood sugar was 18 mmol this morning", "blood_sugar"],
    ["I think I'm having a hypo", "blood_sugar"],
    ["I'm type 2 diabetic and I feel shaky and sweaty", "blood_sugar"],
    ["low blood sugar during my long run", "blood_sugar"],
    ["سكري ٣٫٢ قبل التمرين", "blood_sugar"],
    ["نسبة السكر ٥٤ بعد التمرين", "blood_sugar"],
    ["عندي هبوط سكر", "blood_sugar"],
    ["أنا مريض سكري وأحس برعشة وعرق بارد", "blood_sugar"],
    // Pregnancy warning signs.
    ["I'm spotting a little today", "pregnancy_warning"],
    ["I think my waters broke", "pregnancy_warning"],
    ["I'm leaking fluid since this morning", "pregnancy_warning"],
    ["The baby hasn't moved much today", "pregnancy_warning"],
    ["I've had fewer baby kicks since yesterday", "pregnancy_warning"],
    ["I've been having contractions every ten minutes", "pregnancy_warning"],
    ["حركة الجنين قلت اليوم", "pregnancy_warning"],
    ["البيبي ما يتحرك من أمس", "pregnancy_warning"],
    ["عندي انقباضات من الصبح", "pregnancy_warning"],
    ["نزول ماء من أمس", "pregnancy_warning"],
    // Joint locking, giving way, pop with swelling, sudden swelling, ruptures.
    ["My knee keeps locking up on the stairs", "joint_injury"],
    ["my knee gave way going down the stairs", "joint_injury"],
    ["My ankle gives out when I land", "joint_injury"],
    ["my knee buckled on the last set", "joint_injury"],
    ["I felt a pop in my ankle and now it's puffy", "joint_injury"],
    ["Sudden swelling in my calf after the flight", "joint_injury"],
    ["I think I tore my ACL", "joint_injury"],
    ["My shoulder popped out during the press", "joint_injury"],
    ["ركبتي تخونني لما أنزل الدرج", "joint_injury"],
    // Giving way said after the joint is named ("it gives way").
    ["It gives way on the stairs. It's my left knee.", "joint_injury"],
    ["صارت تخونني ركبتي من أسبوع", "joint_injury"],
    ["كتفي طلع من مكانه", "joint_injury"],
    ["ركبتي منتفخة فجأة", "joint_injury"],
    // Eating-disorder behaviours and relapse.
    ["I've been making myself sick after meals", "eating_disorder"],
    ["I took laxatives to drop weight before weigh-in", "eating_disorder"],
    ["I binged last night and felt awful", "eating_disorder"],
    ["I've been restricting again", "eating_disorder"],
    ["I think I relapsed", "eating_disorder"],
    ["I've been barely eating", "eating_disorder"],
    ["skipping meals to burn it off", "eating_disorder"],
    ["أتقيأ بعد الأكل", "eating_disorder"],
    ["آخذ ملينات عشان أنزل وزن", "eating_disorder"],
    ["أجوع نفسي من أسبوع", "eating_disorder"],
    ["حاسة إني انتكست", "eating_disorder"],
    // Chest pain, fainting, breathlessness at rest, self-harm.
    ["I have pressure in my chest", "urgent"],
    ["I'm out of breath sitting on the sofa", "urgent"],
    ["the room was spinning after the set", "urgent"],
    ["عندي كتمة في صدري", "urgent"],
    ["الدنيا لفت فيني بعد التمرين", "urgent"],
    ["I don't want to be alive anymore", "self_harm"],
    ["I've been cutting myself", "self_harm"],
    ["ما أبي أعيش", "self_harm"],
    ["أبي أموت", "self_harm"],
  ];
  for (const [text, category] of cases) {
    assert.equal(safetySignal(text), true, text);
    assert.ok(
      hasCategory(text, category),
      `${text}: ${redFlagCategories(text)}`,
    );
  }
});

test("everyday gym, food and health wording stays routine", () => {
  for (const text of [
    // Blood pressure within range, or unrelated pressure.
    "My blood pressure is normal, 118/76.",
    "My BP was 128/82 this morning, all good.",
    "BP 132/84, no headache today",
    "My doctor says my blood pressure is fine now",
    "No pressure, I'll train tomorrow",
    "ضغطي طبيعي ١٢٠/٨٠",
    "ضغط صدر بالدمبل ٣ مجموعات",
    // Sugar in food, normal readings.
    "This yoghurt has 20 g of sugar.",
    "I cut added sugar to under 25 grams a day",
    "Is a sugar-free pre-workout ok?",
    "My sugar cravings are bad after dinner",
    "My blood sugar was 5.4 this morning",
    "my sugar is 110 after lunch",
    "I'm confused about when to take metformin",
    "السكر في العصير ٢٥ غرام",
    "سكري ٦ الصبح الحمد لله",
    // Pregnancy app, spotting a lift, muscle contractions, water.
    "Can you spot me on bench today?",
    "I was spotting my friend on squats",
    "Is spotting necessary for dumbbell press?",
    "Focus on slow eccentric contractions",
    "The glute contractions feel strong in hip thrusts",
    "My water bottle broke at the gym",
    "The baby is moving a lot today",
    "التمرين في الهواء الطلق أحسن",
    "انقباضات العضلات قوية في الهيب ثرست",
    "الجنين يتحرك كثير اليوم",
    // Popping, locking out, tired legs, knees caving, the pump.
    "I felt a pop of energy after my coffee",
    "My knees pop a bit when I squat, is that normal?",
    "Should I lock out my knees at the top of the squat?",
    "I locked out my elbows on the bench",
    "My legs gave out on the last rep of squats",
    "My knees buckle inward on squats",
    "My arms are so swollen from the pump",
    "My face is puffy in the morning",
    "ركبتي تطقطق شوي وقت السكوات، عادي؟",
    // Meals, dieting, binge-watching, data purges, twice-a-day training.
    "I skipped breakfast because I was busy",
    "I've been skipping meals because work is crazy, any quick snacks?",
    "I binge-watched Netflix all weekend",
    "I'm restricting carbs this week",
    "I'm not eating anything before my morning run, is that ok?",
    "I'm going to purge old photos from my phone",
    "Can I train twice a day?",
    "I'm slipping back into my old habit of skipping the gym",
    "أفوت الفطور أحياناً بسبب الدوام",
    "ما آكل شي بعد الساعة ٨",
    // Effort, heart rate after intervals, idioms.
    "I'm out of breath after sprints, as expected",
    "My heart is racing after the intervals, is that normal?",
    "I don't want to live on protein shakes",
    "I don't want to wake up early for cardio",
    "أموت من الضحك على الفيديو",
    "أبي أموت من التعب بعد تمرين الأرجل",
    "شفت دمبلات جديدة في النادي",
    "ما في تنقيط الحمد لله",
  ])
    assert.equal(
      safetySignal(text),
      false,
      `${text}: ${redFlagCategories(text)}`,
    );
});

test("pregnancy is still always held; a routine pregnancy mention is not read as a warning sign", () => {
  // The blanket pregnancy hold is part of the floor and is never weakened.
  for (const text of [
    "My pregnancy app says week 22",
    "I'm 22 weeks pregnant, can I keep doing squats?",
    "أنا حامل في الأسبوع ٢٢",
  ]) {
    assert.equal(safetySignal(text), true, text);
    assert.deepEqual(redFlagCategories(text), ["pregnancy"], text);
  }
  assert.ok(
    hasCategory("I'm 22 weeks pregnant and spotting", "pregnancy_warning"),
  );
  // A known condition without a reading or symptom is a personal-review topic, not a hold.
  assert.equal(
    safetySignal("I have high blood pressure, should I avoid heavy squats?"),
    false,
  );
  assert.equal(
    safetySignal("I'm type 2 diabetic, what should I eat before training?"),
    false,
  );
  assert.equal(safetySignal("History of bulimia, in recovery."), false);
});

test("routine negations of the new findings read them as absent", () => {
  for (const text of [
    "No swelling and no locking, just a bit stiff",
    "My knee isn't swollen today",
    "no spotting since last week",
    "no contractions at all",
    "I haven't purged in months",
    "BP 125/80, no headache, no blurred vision",
    "ما فيه ورم في ركبتي",
    "ركبتي تعبانة شوي وما فيها ورم",
  ])
    assert.equal(
      safetySignal(text),
      false,
      `${text}: ${redFlagCategories(text)}`,
    );
  // A negation that does not reach the finding keeps it.
  for (const text of [
    "Not sure why, but my knee locked on the stairs",
    "No pain, but my knee swelled up",
  ])
    assert.equal(safetySignal(text), true, text);
});

test("the policy screen, voice talk-back, spoken lines and meal plans use the same floor", () => {
  assert.deepEqual([...SAFETY_FLOOR.holdCategories], [...RED_FLAG_CATEGORIES]);
  const profilePolicy = fixturePolicy([randomUUID()]);
  for (const [, text, category] of TRIAL_MISSED) {
    const screen = screenSafety(text, FLOOR_ONLY);
    assert.equal(screen.hold, true, text);
    assert.equal(screen.floor, true, text);
    assert.deepEqual(screen.floorCategories, redFlagCategories(text), text);
    assert.ok(screen.floorCategories.includes(category), text);
    // A spoken reply during a voice session stops the session as pain.
    assert.equal(parseVoiceCommand(text).type, "pain", text);
    // A spoken line or phrase with the red flag is refused.
    assert.ok(phraseIssues(text, 400).includes("red_flag"), text);
  }
  // Meal plans: the eating-related red flags in the member's notes route the
  // week to the trainer (SCOPE_REVIEW), a knee report alone does not.
  for (const notes of [
    "I've been skipping meals and running twice a day. I feel like I'm slipping back.",
    "My sugar was 65 before training and I felt shaky.",
    "صاير أفوّت الوجبات وأركض مرتين باليوم، أحس إني أرجع لنفس الحالة.",
    "I've been making myself sick after meals",
  ])
    assert.throws(
      () => nutritionTarget(profilePolicy, { ...fixtureProfile, notes }),
      (e: any) => e instanceof NutritionBlocked && e.code === "SCOPE_REVIEW",
      notes,
    );
  assert.deepEqual(
    nutritionRedFlags([
      "My knee locked and swelled up after my walk yesterday.",
    ]),
    [],
  );
  assert.equal(
    nutritionTarget(profilePolicy, {
      ...fixtureProfile,
      notes: "My knee locked and swelled up after my walk yesterday.",
    }),
    1500,
  );
  assert.equal(
    nutritionTarget(profilePolicy, {
      ...fixtureProfile,
      notes: "Sugar-free drinks; 20 g of sugar a day at most.",
    }),
    1500,
  );
});

test("policy terms match Arabic-Indic digits as well as Latin ones", () => {
  const policy = {
    redFlagTerms: ["dialysis"],
    personalReviewCategories: ["possible_minor" as const],
    personalReviewTerms: ["عمري 15"],
  };
  for (const text of [
    "عمري ١٦ سنة، هل أقدر أتمرن معكم؟",
    "انا عمري 16 سنة",
    "عمري ۱۷",
  ]) {
    const screen = screenSafety(text, policy);
    assert.equal(screen.review, true, text);
    assert.deepEqual(screen.reviewCategories, ["possible_minor"], text);
  }
  assert.deepEqual(screenSafety("عمري ١٥", policy).reviewCategories, [
    "possible_minor",
    "custom",
  ]);
  assert.equal(screenSafety("عمري ٢٦ سنة", policy).review, false);
});

test("the floor stays fast on long and adversarial input", () => {
  const inputs = [
    "my sugar " + "a ".repeat(2000) + "65",
    "ركبتي " + "ا".repeat(4000),
    "knee ".repeat(800) + "locked",
    "blood pressure " + "1/".repeat(1500),
    ("I heard a pop in my knee. ".repeat(150) + "no swelling ").slice(0, 4000),
  ];
  const started = performance.now();
  for (const text of inputs) redFlagCategories(text);
  assert.ok(
    performance.now() - started < 1500,
    `took ${performance.now() - started} ms`,
  );
});
