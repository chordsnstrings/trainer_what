// Verifies traces.json and brain-core.js decide() against the app's own code.
// Run from the repo:  cd /home/user/trainer_what && npx tsx <this file>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { redFlagCategories } from "/home/user/trainer_what/packages/domain/src/red-flags.ts";
import { planConfidence, planRoute, caseCoverage, planSettingsSchema } from "/home/user/trainer_what/packages/domain/src/brain-plans.ts";
import { reducedLoad as domReduced, VOICE_SAFETY_LINE, formatLoad } from "/home/user/trainer_what/packages/domain/src/voice-session.ts";
import { reduceWhoopWorkout } from "/home/user/trainer_what/packages/domain/src/whoop-training.ts";
import { BRAIN_LEVELS } from "/home/user/trainer_what/packages/domain/src/brain-teach.ts";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "/home/user/trainer_what/";
const core: any = { ...(await import(join(HERE, "brain-core.js"))), ...(await import(join(HERE, "brain-decide.js"))) };
const d: any = core.index(JSON.parse(readFileSync(join(HERE, "traces.json"), "utf8")));
const fails: string[] = [];
let checks = 0;
const ok = (c: any, m: string) => { checks++; if (!c) fails.push(m); };
const eq = (a: any, b: any, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const src = (f: string) => readFileSync(REPO + f, "utf8");

/* 1 · schema */
ok(d.format === "trainsyou-brain-trace@2", "format");
eq(d.specialists.length, 25, "25 specialists");
eq(d.traces.length, 12, "12 traces");
const NAMES = ["Interviewer", "Rule writer", "Quiz master", "Style drafter", "Wording helper", "Learner", "Weekly learner", "Examiner",
  "Reply picker", "Draft writer", "Plan writer", "Week reviewer", "Meal planner", "Meal photo reader", "Voice lines",
  "Safety rules", "Your topics", "Memory", "Rule finder", "Checker", "Confidence", "Lane gate", "Recovery rule", "Set logger", "Today list"];
eq(d.specialists.map((s: any) => s.name).sort(), NAMES.slice().sort(), "roster names");
eq(d.specialists.filter((s: any) => s.kind === "ai").length, 14, "14 AI specialists");
eq(d.specialists.filter((s: any) => s.kind === "check").length, 11, "11 code steps");
for (const s of d.specialists) {
  for (const k of ["id", "name", "kind", "crew", "icon", "line", "signsOff", "status", "code"]) ok(typeof s[k] === "string", `${s.id}.${k}`);
  ok(["ai", "check"].includes(s.kind), `${s.id} kind`);
  ok(["teach", "coach", "guard"].includes(s.crew), `${s.id} crew`);
  ok(["live", "try_yourself", "not_on_yet"].includes(s.status), `${s.id} status`);
  if (s.status === "try_yourself") ok(typeof s.statusTip === "string", `${s.id} statusTip`);
  if (s.status === "not_on_yet") ok(typeof s.flag === "string", `${s.id} flag`);
  ok(!/sure score|rep counter/i.test(JSON.stringify(s)), `${s.id} old names`);
}
eq(d.specialists.filter((s: any) => s.status === "not_on_yet").map((s: any) => s.id).sort(), ["meal_planner", "recovery"], "Not on yet shelf");
ok(d.sp.examiner.usesAi === true && d.sp.examiner.kind === "check", "Examiner: code step that uses your AI");
const SP = new Set([...Object.keys(d.sp), "any_ai", "you", "member", "code"]);
const BASIS = new Set(["recorded", "tests", "illustrative", "computed"]);
for (const t of d.traces) {
  const k = t.id;
  for (const f of ["id", "chip", "decide", "member", "when", "channel", "lane", "status", "subtitle"]) ok(typeof t[f] === "string", `${k}.${f}`);
  ok(typeof t.weight === "number" && t.weight > 0, `${k}.weight`);
  ok(t.trigger && typeof t.trigger.text === "string" && ["en", "ar"].includes(t.trigger.lang), `${k}.trigger`);
  ok(t.lane in d.labels.lanes, `${k}.lane`);
  ok(Array.isArray(t.controls) && Array.isArray(t.variants), `${k} controls/variants`);
  ok(t.sure === null || (typeof t.sure.score === "number" && typeof t.sure.display === "string"), `${k}.sure`);
  ok(t.basis && typeof t.basis.note === "string", `${k}.basis.note`);
  let prev = -1;
  for (const s of t.steps) {
    ok(SP.has(s.sp), `${k} step sp ${s.sp}`);
    ok(typeof s.at === "number" && typeof s.dur === "number", `${k} ${s.sp} at/dur`);
    ok(s.at >= prev, `${k} ${s.sp} order`); prev = s.at;
    ok(typeof s.result === "string" && typeof s.say === "string", `${k} ${s.sp} result/say`);
    if (s.basis) ok(BASIS.has(s.basis), `${k} ${s.sp} basis ${s.basis}`);
    if (s.sp in d.sp && d.sp[s.sp].kind === "ai" && s.result !== "skipped") ok(BASIS.has(s.basis), `${k} AI step ${s.sp} has a basis tag`);
    if (s.sp === "code") ok(typeof s.label === "string", `${k} code step label`);
  }
  // never several AI specialists on one message (Learner works on the trainer's edit, a separate moment)
  const ais = t.steps.filter((s: any) => s.sp in d.sp && d.sp[s.sp].kind === "ai" && s.sp !== "learner").map((s: any) => s.sp);
  ok(new Set(ais).size <= 1, `${k}: one AI specialist per message (${ais})`);
  // subtitle quotes are exact substrings of the trigger
  for (const m of t.subtitle.matchAll(/“([^”]+)”/g)) ok(t.trigger.text.includes(m[1]), `${k} subtitle quote "${m[1]}"`);
  // chat replies have no confidence
  if (t.channel === "chat") ok(t.sure === null, `${k}: chat has no score`);
  // floor stops call no AI
  if (t.decide === "floor") ok(t.steps.every((s: any) => !(s.sp in d.sp && d.sp[s.sp].kind === "ai")) && t.steps.some((s: any) => s.sp === "any_ai" && s.result === "skipped"), `${k}: safety stop calls no AI`);
}
ok(d.trace("t3").defaultOff === true, "t3 off by default");
eq(d.settingsDefault.recovery.on, false, "recovery off by default");
for (const key of ["eyebrow", "picks", "noChatScore", "howWeCount", "totals", "levels", "planSetting", "spotCheck", "supplements", "recoveryCaption", "chip", "long", "subscribers", "rates", "speed", "noAi", "basis", "status", "kind", "lanes"])
  ok(key in d.labels, `labels.${key}`);

/* 2 · honesty strings (spec §1.5) */
eq(d.labels.chip, "Sample · scripted · no AI model called", "chip");
eq(d.labels.subscribers, "Subscribers can't join yet: subscriber payments are not on. You can run all of this on yourself today with Try my AI.", "status strip");
eq(d.labels.eyebrow, "A SAMPLE HOUR OF YOUR BRAIN", "eyebrow");
eq(d.labels.rates, "A mix chosen to show every path. Not real rates.", "rates");
eq(d.labels.long, "Sample moments. Code steps use the app's own limits on sample data. AI steps replay answers from test runs, or are marked illustrative. No AI model is called on this page.", "banner");
eq(d.labels.basis, { recorded: "From a test run", tests: "From the app's tests", illustrative: "Illustrative", computed: "Worked out by the app's own rules" }, "basis tags");
eq(d.labels.picks, "Code picks the specialist. No AI chooses which AI runs.", "picks");
eq(d.labels.noChatScore, "Chat replies have no score. They must cite your rule.", "noChatScore");
eq(d.labels.spotCheck, "Spot check: 1 in 4 sent plans while fewer than 20 are reviewed.", "spotCheck");
eq(d.labels.levels.note, "Level 2 needs a passing check of 20+ of your own cases.", "levels.note");
eq(d.labels.kind.check, "Code, no AI", "kind.check");
ok(!/\b(seed|doubao|bytedance|gpt|openai|claude|anthropic|gemini|llama|mistral)\b/i.test(JSON.stringify(d)), "no model or vendor names");

/* 3 · verbatim against the code */
for (const l of [1, 2, 3]) {
  const b = BRAIN_LEVELS.find((x) => x.level === l)!;
  eq(d.labels.levels[l].name, b.name, `level ${l} name`);
  eq(d.labels.levels[l].summary, b.summary, `level ${l} summary`);
}
ok(src("apps/web/components/brain-plans.tsx").includes(`"${d.labels.planSetting.label}", ${d.labels.planSetting.min}, ${d.labels.planSetting.max}`), "plan slider label + range");
const ps = planSettingsSchema.parse({});
eq([ps.threshold, ps.spotCheckRate, ps.youngBrainReviews, ps.mode], [d.settingsDefault.threshold, 0.25, 20, d.settingsDefault.planMode], "plan settings defaults");
ok(src("apps/api/src/brain-check.ts").includes("const RECHECK_DELAY_SECONDS = 60;"), "Examiner ~1 minute later");
const t5 = d.trace("t5");
ok(t5.steps.find((s: any) => s.sp === "set_logger").script[0].text === VOICE_SAFETY_LINE, "t5 opens with VOICE_SAFETY_LINE");
const cc = src("apps/api/src/coaching-completion.ts"), cr = src("apps/api/src/coaching-runtime.ts"), wl = src("apps/web/components/workspace-live.ts");
for (const t of d.traces) for (const p of (t.memberSees?.parts || []).filter((p: any) => p.by === "platform"))
  ok(cc.includes(p.text) || cr.includes(p.text), `${t.id} platform text verbatim: ${p.text}`);
ok(cr.includes("` Your next ${action.data.exercise} prescription is ${replacement.loadKg} kg.`"), "t1 code sentence template");
eq(d.trace("t1").memberSees.parts[1].text, `Your next Back Squat prescription is ${60 + 2.5} kg.`, "t1 code sentence");
ok(src("apps/web/components/trainer-today.tsx").includes("Make this a rule?"), "Make this a rule?");
for (const [a, b] of [["Answered ${client}", "Sent on its own, within your rules"], ["Sent a plan${forClient}", "Delivered on its own"], ["Adjusted a plan${forClient}", "From how the week went"], ["Learned a rule from you", "It uses it from now on"]])
  ok(wl.includes(a) && wl.includes(b), `feed wording ${b}`);
eq(d.labels.lanes.sent, "Sent on its own, within your rules", "lane sent wording");
const vr = src("packages/domain/src/voice-runner.ts");
ok(vr.includes("Lighter weight for the next set: ${formatLoad(floor)} kilograms.") && vr.includes("Your trainer's plan keeps this weight. Say pain if something hurts."), "too-heavy lines");

/* 4 · safety rules: categories and highlight words */
for (const t of d.traces.filter((t: any) => t.channel === "chat")) {
  const got = redFlagCategories(t.trigger.text);
  const f = t.steps.find((s: any) => s.sp === "safety" && s.fn);
  const want = f ? (f.fn.match(/\[(.*)\]/)![1].split(",").map((x: string) => x.trim()).filter(Boolean)) : [];
  eq(got, want, `${t.id} redFlagCategories`);
  if (t.decide === "floor") ok(got.length > 0, `${t.id} floor hit`); else eq(got, [], `${t.id} routine for safety`);
  for (const w of f?.highlight || []) {
    const toks = t.trigger.text.split(/\s+/);
    let hit = false;
    for (let i = 0; i < toks.length && !hit; i++) for (let j = i + 1; j <= Math.min(toks.length, i + 8) && !hit; j++) {
      const ph = toks.slice(i, j).join(" ");
      if (ph.includes(w) && redFlagCategories(ph).some((c: string) => got.includes(c))) hit = true;
    }
    ok(hit && t.trigger.text.includes(w), `${t.id} highlight "${w}" sits in a sub-phrase that triggers alone`);
  }
}

/* 5 · plan maths: decide() vs planConfidence + planRoute */
const seg = { goal: "strength", experience: "intermediate", daysPerWeek: 4, equipment: [] as string[] };
let planCombos = 0;
for (const id of ["t8", "t10"]) {
  const t = d.trace(id), g = t.sure.signals, ad = g.logged !== undefined;
  for (const bar of [50, 66, 75, 78, 79, 80, 83, 86, 87, 88, 90, 99]) for (const eqr of [false, true]) for (const more of [false, true])
    for (const logged of ad ? [1, 0.75, 0.5, 0.25] : [1]) for (const mode of ["automatic", "supervised"]) {
      const s = { ...core.defaults(d), bar, addEquipmentRule: eqr, oneMoreApproved: more, loggedShare: logged, planMode: mode };
      const mine = core.planScore(t, s);
      const rules = eqr ? 1 : g.rules;
      const learning = [...Array(g.cases.approved + (more ? 1 : 0))].map(() => ({ decision: "approved", segment: seg, type: ad ? "adaptation" : "programme" }));
      const conf = planConfidence({
        ruleCoverage: { score: rules, facets: { goal: true, experience: true, equipment: rules === 1, schedule: true, progression: true } } as any,
        caseCoverage: caseCoverage(seg, learning, ad ? "adaptation" : "programme"),
        validation: { errors: [], warnings: g.checks.list, metrics: { exerciseCount: 8, taggedExercises: 8 * g.library, untaggedExercises: [] } } as any,
        selfConfidence: g.model, uncertainties: [], threshold: bar / 100, ...(ad ? { outcomeEvidence: logged } : {}),
      });
      const route = planRoute({ type: ad ? "adaptation" : "programme", mode: mode as any, qualified: true, safety: [], confidence: conf, validation: { errors: [], warnings: g.checks.list, metrics: { exerciseCount: 8, taggedExercises: 8, untaggedExercises: [] } } as any, equipment: "full gym" });
      const tag = `${id} bar ${bar} eq ${eqr} more ${more} logged ${logged} ${mode}`;
      eq(mine.score, conf.score, tag + " score");
      eq(mine.auto, route.route === "automatic", tag + " route");
      eq(mine.reasons, route.reasons, tag + " reasons");
      eq(mine.pct, Math.round(conf.score * 100), tag + " % rounding");
      eq(core.decide(t, s, d).lane, route.route === "automatic" ? "sent" : "waits", tag + " lane");
      planCombos++;
    }
}
eq(core.planScore(d.trace("t8"), core.defaults(d)).score, 0.78, "t8 0.78");
eq(core.planScore(d.trace("t10"), core.defaults(d)).score, 0.862, "t10 0.862");
eq(core.decide(d.trace("t10"), { ...core.defaults(d), bar: 86 }, d).lane, "sent", "86% passes 0.862");
eq(core.decide(d.trace("t10"), { ...core.defaults(d), bar: 87 }, d).lane, "waits", "87% does not");
const base8 = core.planScore(d.trace("t8"), core.defaults(d));
eq(base8.reasons, d.trace("t8").reasons, "t8 reasons in JSON match the app's wording");
eq(base8.display, d.trace("t8").sure.display, "t8 display");
eq(core.planScore(d.trace("t10"), core.defaults(d)).display, d.trace("t10").sure.display, "t10 display");

/* 6 · voice too-heavy and recovery maths */
for (let p = 0; p <= 20; p++) eq(core.reducedLoad(60, p), domReduced(60, { tooHeavyReducePercent: p } as any), `reducedLoad 60 kg ${p}%`);
eq(core.decide(t5, core.defaults(d), d).memberSees.parts[0].text, `Lighter weight for the next set: ${formatLoad(54)} kilograms.`, "t5 54 kg");
const w = d.trace("t3").inputs.workout;
let whoop = 0;
for (let L = 0; L <= 30; L += 5) for (let V = 0; V <= 50; V += 5) {
  const prog = { exercises: w.map((e: any) => ({ ...e, alternatives: e.alt ? [e.alt] : [] })) };
  const dom = reduceWhoopWorkout(prog, { loadPercent: L, volumePercent: V }).program.exercises;
  const mine = core.reduceWorkout(w, L, V);
  mine.forEach((e: any, i: number) => {
    for (const k of ["loadKg", "reps", "durationSeconds", "distanceMeters"]) eq(e[k], dom[i][k], `whoop L${L} V${V} ${e.name}.${k}`);
    if (e.alt) eq(e.alt.loadKg, dom[i].alternatives[0].loadKg, `whoop L${L} V${V} alt`);
  });
  whoop++;
}
const on = { ...core.defaults(d), recoveryFlag: true };
eq(core.decide(d.trace("t3"), on, d).steps[1].detail, d.trace("t3").steps[1].detail, "t3 detail lines from reduceWhoopWorkout");
for (const v of d.trace("t3").variants.filter((v: any) => v.detail))
  eq(core.decide(d.trace("t3"), { ...on, recoveryReading: v.when.recovery }, d).steps[1].detail.slice(0, -1), v.detail, `t3 variant ${v.when.recovery}`);

/* 7 · decide() reproduces every lane and every variant */
for (const t of d.traces) eq(core.decide(t, on, d).lane, t.lane, `${t.id} default lane`);
const VAR: any = {
  level: (s: any, v: any) => ({ ...s, level: v }), capPctBelow: (s: any, v: any) => ({ ...s, capPct: Math.floor(v) }), minRirAbove: (s: any, v: any) => ({ ...s, minRir: v + 1 }),
  recovery: (s: any, v: any) => ({ ...s, recoveryReading: v }), recoveryOn: (s: any, v: any) => ({ ...s, recoveryRule: v }), tooHeavyPct: (s: any, v: any) => ({ ...s, tooHeavyPct: v }),
  thresholdAtMost: (s: any, v: any) => ({ ...s, bar: Math.round(v * 100) }), thresholdAbove: (s: any, v: any) => ({ ...s, bar: Math.round(v * 100) + 1 }),
  addEquipmentRule: (s: any, v: any) => ({ ...s, addEquipmentRule: v }), oneMoreApproved: (s: any, v: any) => ({ ...s, oneMoreApproved: v }),
  loggedShare: (s: any, v: any) => ({ ...s, loggedShare: v }), planMode: (s: any, v: any) => ({ ...s, planMode: v }), supplementsTopic: (s: any, v: any) => ({ ...s, supplementsTopic: v }),
};
for (const t of d.traces) for (const v of t.variants) {
  const [key, val] = Object.entries(v.when)[0] as [string, any];
  ok(key in VAR, `${t.id} variant key ${key}`);
  const r = core.decide(t, VAR[key](on, val), d);
  eq(r.lane, v.lane, `${t.id} variant ${key}=${val} lane`);
  if (v.score) eq(r.sure.score, v.score, `${t.id} variant ${key} score`);
  if (v.memberSees && t.decide === "voice") eq(r.memberSees.parts[0].text, v.memberSees, `${t.id} variant ${key}=${val} line`);
}
ok(core.decide(d.trace("t1"), { ...on, capPct: 3 }, d).why.startsWith("2.5 kg is 4.2%, over your 3% cap."), "diff-line example");

/* 8 · totals */
eq(core.totals(d, core.defaults(d)), d.labels.totals.recoveryOff, "totals, recovery flag off");
eq(core.totals(d, on), d.labels.totals.recoveryOn, "totals, recovery flag on");

console.log(JSON.stringify({ checks, planCombos, whoopCombos: whoop, fails: fails.length }, null, 0));
if (fails.length) { console.log(fails.slice(0, 40).join("\n")); process.exit(1); }
