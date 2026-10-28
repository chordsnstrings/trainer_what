// The Brain showcases' sample traces stay true to the product
// (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.3). The traces
// (apps/web/components/marketing/brain/data/traces.json) and the engine's
// decide() are checked against the app's own functions and wording, as the
// approved prototype's verifier did (prototypes/shared/brain/tools/verify.mts,
// checks 1–8), plus the claims the pages and the showcases share, the client
// copy, the copy scans and prepare(). A product change that breaks a check
// means the traces need the same change: see docs/features/brain-showcase.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AVAILABILITY_LINES, SETUP_BRAIN_MINIMUM, SETUP_STEPS } from "@trainer/contracts";
import { MARKETING_CONTENT } from "../packages/contracts/src/marketing-content.ts";
import { redFlagCategories, RED_FLAG_CATEGORIES } from "../packages/domain/src/red-flags.ts";
import {
  caseCoverage,
  planBoundsSchema,
  planConfidence,
  planRoute,
  planSettingsSchema,
} from "../packages/domain/src/brain-plans.ts";
import { formatLoad, reducedLoad as domainReducedLoad, VOICE_SAFETY_LINE } from "../packages/domain/src/voice-session.ts";
import { reduceWhoopWorkout } from "../packages/domain/src/whoop-training.ts";
import {
  BRAIN_LEVELS,
  OWN_CASES_FOR_FULL_CHECK,
  OWN_CASES_FOR_SUPERVISED,
} from "../packages/domain/src/brain-teach.ts";
import { ruleGroups, type RuleCard } from "../apps/web/components/setup-wizard-model.ts";
import { index } from "../apps/web/components/marketing/brain/engine/core.js";
import * as decider from "../apps/web/components/marketing/brain/engine/decide.js";
import { NON_TEXT_KEYS, prepare, stripForClient } from "../apps/web/components/marketing/brain/engine/data.js";
import { strip } from "../apps/web/components/marketing/brain/engine/ui.js";
import { C0_BANNED, MODEL_OR_VENDOR, PLACEHOLDER } from "./marketing-helpers.ts";

const repo = (path: string) => new URL("../" + path, import.meta.url);
const src = (path: string) => readFileSync(repo(path), "utf8");
const DATA = "apps/web/components/marketing/brain/data/";
const HOW = "update the traces with the product: docs/features/brain-showcase.md";
// The canonical copy (the generator and this test read it) and the client
// copy (the render and runtime modules import it).
const fullText = src(DATA + "traces.json");
const clientText = src(DATA + "traces.client.json");
const full: any = JSON.parse(fullText);
const d: any = index(JSON.parse(fullText));
const core: any = decider;

/** Collects every failed check of a block, as the prototype's verifier did. */
function checks() {
  const fails: string[] = [];
  let count = 0;
  return {
    ok(c: unknown, m: string) {
      count++;
      if (!c) fails.push(m);
    },
    eq(a: unknown, b: unknown, m: string) {
      count++;
      if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    },
    done(min = 1) {
      assert.deepEqual(fails.slice(0, 40), [], `${fails.length} of ${count} checks failed (${HOW})`);
      assert.ok(count >= min, `${count} checks`);
    },
  };
}
const OFF = { payments: false, payouts: false, voice: false, nutrition: false, recovery: false };
const ON = { ...OFF, recoveryFlag: true };
const settings = (patch: object = {}) => ({ ...core.defaults(d), ...patch });

test("schema and roster: 25 specialists (14 AI, 11 code steps), 12 traces, every step well formed", () => {
  const c = checks();
  c.ok(d.format === "trainsyou-brain-trace@2", "format");
  c.eq(d.specialists.length, 25, "25 specialists");
  c.eq(d.traces.length, 12, "12 traces");
  const NAMES = ["Interviewer", "Rule writer", "Quiz master", "Style drafter", "Wording helper", "Learner", "Weekly learner", "Examiner",
    "Reply picker", "Draft writer", "Plan writer", "Week reviewer", "Meal planner", "Meal photo reader", "Voice lines",
    "Safety rules", "Your topics", "Memory", "Rule finder", "Checker", "Confidence", "Lane gate", "Recovery rule", "Set logger", "Today list"];
  c.eq(d.specialists.map((s: any) => s.name).sort(), NAMES.slice().sort(), "roster names");
  c.eq(d.specialists.filter((s: any) => s.kind === "ai").length, 14, "14 AI specialists");
  c.eq(d.specialists.filter((s: any) => s.kind === "check").length, 11, "11 code steps");
  for (const s of d.specialists) {
    for (const k of ["id", "name", "kind", "crew", "icon", "line", "signsOff", "status", "code"]) c.ok(typeof s[k] === "string", `${s.id}.${k}`);
    c.ok(["ai", "check"].includes(s.kind), `${s.id} kind`);
    c.ok(["teach", "coach", "guard"].includes(s.crew), `${s.id} crew`);
    c.ok(["live", "try_yourself", "not_on_yet"].includes(s.status), `${s.id} status`);
    if (s.status === "try_yourself") c.ok(typeof s.statusTip === "string", `${s.id} statusTip`);
    if (s.status === "not_on_yet") c.ok(typeof s.flag === "string", `${s.id} flag`);
    if (s.needs) c.ok(s.status === "try_yourself" && ["voice", "nutrition"].includes(s.needs), `${s.id} needs`);
    c.ok(!/sure score|rep counter/i.test(JSON.stringify(s)), `${s.id} old names`);
  }
  c.ok(d.sp.examiner.usesAi === true && d.sp.examiner.kind === "check", "Examiner: code step that uses your AI");
  const SP = new Set([...Object.keys(d.sp), "any_ai", "you", "member", "code"]);
  const BASIS = new Set(["recorded", "tests", "illustrative", "computed"]);
  for (const t of d.traces) {
    const k = t.id;
    for (const f of ["id", "chip", "decide", "member", "when", "channel", "lane", "status", "subtitle"]) c.ok(typeof t[f] === "string", `${k}.${f}`);
    c.ok(typeof t.weight === "number" && t.weight > 0, `${k}.weight`);
    c.ok(t.trigger && typeof t.trigger.text === "string" && ["en", "ar"].includes(t.trigger.lang), `${k}.trigger`);
    c.ok(t.lane in d.labels.lanes, `${k}.lane`);
    c.ok(Array.isArray(t.controls) && Array.isArray(t.variants), `${k} controls/variants`);
    c.ok(t.sure === null || (typeof t.sure.score === "number" && typeof t.sure.display === "string"), `${k}.sure`);
    c.ok(t.basis && typeof t.basis.note === "string", `${k}.basis.note`);
    let prev = -1;
    for (const s of t.steps) {
      c.ok(SP.has(s.sp), `${k} step sp ${s.sp}`);
      c.ok(typeof s.at === "number" && typeof s.dur === "number", `${k} ${s.sp} at/dur`);
      c.ok(s.at >= prev, `${k} ${s.sp} order`);
      prev = s.at;
      c.ok(typeof s.result === "string" && typeof s.say === "string", `${k} ${s.sp} result/say`);
      if (s.basis) c.ok(BASIS.has(s.basis), `${k} ${s.sp} basis ${s.basis}`);
      if (s.sp in d.sp && d.sp[s.sp].kind === "ai" && s.result !== "skipped") c.ok(BASIS.has(s.basis), `${k} AI step ${s.sp} has a basis tag`);
      if (s.sp === "code") c.ok(typeof s.label === "string", `${k} code step label`);
    }
    // never several AI specialists on one message (the Learner works on the trainer's edit, a separate moment)
    const ais = t.steps.filter((s: any) => s.sp in d.sp && d.sp[s.sp].kind === "ai" && s.sp !== "learner").map((s: any) => s.sp);
    c.ok(new Set(ais).size <= 1, `${k}: one AI specialist per message (${ais})`);
    // subtitle quotes are exact substrings of the trigger
    for (const m of t.subtitle.matchAll(/“([^”]+)”/g)) c.ok(t.trigger.text.includes(m[1]), `${k} subtitle quote "${m[1]}"`);
    if (t.channel === "chat") c.ok(t.sure === null, `${k}: chat has no score`);
    if (t.decide === "floor")
      c.ok(
        t.steps.every((s: any) => !(s.sp in d.sp && d.sp[s.sp].kind === "ai")) && t.steps.some((s: any) => s.sp === "any_ai" && s.result === "skipped"),
        `${k}: safety stop calls no AI`,
      );
    if (t.needs) c.ok(t.status === "try_yourself" && ["voice", "nutrition"].includes(t.needs), `${k} needs`);
  }
  for (const key of ["eyebrow", "picks", "noChatScore", "howWeCount", "totals", "levels", "planSetting", "spotCheck", "supplements", "recoveryCaption", "chip", "long", "subscribers", "subscribersNoModel", "rates", "speed", "noAi", "basis", "status", "kind", "lanes"])
    c.ok(key in d.labels, `labels.${key}`);
  c.done(500);
});

test("only the Recovery rule is never on in phase 1; with the platform's default flags the Meal planner, the meal photo and voice specialists wait too; t3 and the recovery rule are off by default", () => {
  assert.deepEqual(d.specialists.filter((s: any) => s.status === "not_on_yet").map((s: any) => s.id).sort(), ["recovery"]);
  const off = prepare(full, { appName: "trainsyou", flags: OFF }) as any;
  assert.deepEqual(off.specialists.filter((s: any) => s.status === "not_on_yet").map((s: any) => s.id).sort(), ["meal_photo", "meal_planner", "recovery", "set_logger", "voice_lines"]);
  assert.equal(d.trace("t3").defaultOff, true);
  assert.equal(d.settingsDefault.recovery.on, false);
  assert.equal(core.defaults(d).recoveryFlag, false, "no flags: recovery off");
  assert.equal(core.defaults(prepare(full, { appName: "trainsyou", flags: OFF })).recoveryFlag, false);
  assert.equal(core.isOff(d.trace("t3"), core.defaults(d)), true);
});

test("the honesty strings are exact (SHOWCASE_DESIGN.md §1.5)", () => {
  const c = checks();
  c.eq(d.labels.chip, "Sample · scripted · no AI model called", "chip");
  c.eq(d.labels.subscribers, "Subscribers can't join yet: subscriber payments are not on. You can run most of this on yourself with Try my AI.", "status strip");
  c.eq(d.labels.subscribersNoModel, "Subscribers can't join yet: subscriber payments are not on.", "status strip without the AI model");
  c.eq(d.labels.eyebrow, "A SAMPLE HOUR OF YOUR BRAIN", "eyebrow");
  c.eq(d.labels.rates, "A mix chosen to show every path. Not real rates.", "rates");
  c.eq(d.labels.long, "Sample moments. Code steps use the app's own limits on sample data. AI steps replay answers from test runs, or are marked illustrative. No AI model is called on this page.", "banner");
  c.eq(d.labels.basis, { recorded: "From a test run", tests: "From the app's tests", illustrative: "Illustrative", computed: "Worked out by the app's own rules" }, "basis tags");
  c.eq(d.labels.picks, "Code picks the specialist. No AI chooses which AI runs.", "picks");
  c.eq(d.labels.noChatScore, "Chat replies have no score. They must cite your rule.", "noChatScore");
  c.eq(d.labels.spotCheck, "Spot check: 1 in 4 sent plans while fewer than 20 are reviewed.", "spotCheck");
  c.eq(d.labels.levels.note, "Level 2 needs a passing check of 20+ of your own cases.", "levels.note");
  c.eq(d.labels.kind.check, "Code, no AI", "kind.check");
  c.done();
});

test("wording quoted from the product matches the product code, and the open verify items are resolved", () => {
  const c = checks();
  for (const l of [1, 2, 3]) {
    const b = BRAIN_LEVELS.find((x) => x.level === l)!;
    c.eq(d.labels.levels[l].name, b.name, `level ${l} name`);
    c.eq(d.labels.levels[l].summary, b.summary, `level ${l} summary`);
  }
  c.ok(src("apps/web/components/brain-plans.tsx").includes(`"${d.labels.planSetting.label}", ${d.labels.planSetting.min}, ${d.labels.planSetting.max}`), "plan slider label + range");
  const ps = planSettingsSchema.parse({});
  c.eq([ps.threshold, ps.spotCheckRate, ps.youngBrainReviews, ps.mode], [d.settingsDefault.threshold, 0.25, 20, d.settingsDefault.planMode], "plan settings defaults");
  c.ok(src("apps/api/src/brain-check.ts").includes("const RECHECK_DELAY_SECONDS = 60;"), "Examiner ~1 minute later");
  const t5 = d.trace("t5");
  c.ok(t5.steps.find((s: any) => s.sp === "set_logger").script[0].text === VOICE_SAFETY_LINE, "t5 opens with VOICE_SAFETY_LINE");
  const cc = src("apps/api/src/coaching-completion.ts"), cr = src("apps/api/src/coaching-runtime.ts"), wl = src("apps/web/components/workspace-live.ts");
  for (const t of d.traces)
    for (const p of (t.memberSees?.parts || []).filter((p: any) => p.by === "platform"))
      c.ok(cc.includes(p.text) || cr.includes(p.text), `${t.id} platform text verbatim: ${p.text}`);
  c.ok(cr.includes("` Your next ${action.data.exercise} prescription is ${replacement.loadKg} kg.`"), "t1 code sentence template");
  c.eq(d.trace("t1").memberSees.parts[1].text, `Your next Back Squat prescription is ${60 + 2.5} kg.`, "t1 code sentence");
  c.ok(src("apps/web/components/trainer-today.tsx").includes("Make this a rule?"), "Make this a rule?");
  for (const [a, b] of [["Answered ${client}", "Sent on its own, within your rules"], ["Sent a plan${forClient}", "Delivered on its own"], ["Adjusted a plan${forClient}", "From how the week went"], ["Learned a rule from you", "It uses it from now on"]])
    c.ok(wl.includes(a) && wl.includes(b), `feed wording ${b}`);
  c.eq(d.labels.lanes.sent, "Sent on its own, within your rules", "lane sent wording");
  const vr = src("packages/domain/src/voice-runner.ts");
  c.ok(vr.includes("Lighter weight for the next set: ${formatLoad(floor)} kilograms.") && vr.includes("Your trainer's plan keeps this weight. Say pain if something hurts."), "too-heavy lines");

  // The Today cards (the prototype's open verify items, resolved for phase 1).
  const inbox = src("apps/api/src/trainer-inbox.ts");
  const card = (title: string) => inbox.indexOf(`title: "${title}"`);
  // t6: a held runtime decision is a decision plus an exception carrying its
  // decisionId (coaching-runtime.ts), and the inbox titles such an exception
  // "Your Brain drafted a reply".
  c.eq(d.trace("t6").trainerSees.title, "Your Brain drafted a reply", "t6 card");
  c.ok(/if \(!automatic\) \{\s+const decision = await putPrivateRecord\(tx, a, "decision"[\s\S]{0,400}"exception",\s+\{[\s\S]{0,200}decisionId: decision\.id/.test(cr), "a held reply files an exception with its decisionId");
  c.ok(/else if \(e\.data\?\.decisionId && drafts\.has\(e\.data\.decisionId\)\) \{\s+push\(\{\s+type: "reply_draft",[\s\S]{0,200}title: "Your Brain drafted a reply"/.test(inbox), "t6 card for a held decision");
  // t9: a personal-review topic opens an exception with no decisionId
  // (openPersonalReview; member_policy_review_append only adds follow-ups
  // to that open exception), which the inbox titles "Waiting for your reply".
  c.eq(d.trace("t9").trainerSees.title, "Waiting for your reply", "t9 card");
  const policy = src("apps/api/src/safety-policy.ts");
  const review = policy.slice(policy.indexOf("export async function openPersonalReview"), policy.indexOf("export async function openPersonalReview") + 2500);
  c.ok(/putPrivateRecord\(\s+tx,\s+a,\s+"exception",\s+\{\s+category: "policy_review"/.test(review) && !review.includes("decisionId"), "a personal review is an exception with no decisionId");
  const append = src("packages/db/migrations/061_tenant_scope_isolation.sql");
  c.ok(/r\.kind='exception' AND r\.status='open'\s+AND r\.owner_user_id=caller AND r\.data->>'category'='policy_review'/.test(append), "member_policy_review_append joins the open review exception");
  c.ok(card("Waiting for your reply") > card("Your Brain drafted a reply") && card("Your Brain drafted a reply") > card("Safety report"), "t9 card: the inbox's last branch");
  // t7: the Learner gets the draft, your reply, your note and the category,
  // names removed, never a member message; a Try my AI draft held for you
  // (no approved reply fits: an escalation, never auto-approved in the
  // preview) is an exception with a decisionId, and your edit to it queues
  // the Learner.
  const learning = src("apps/api/src/brain-learning.ts");
  const material = learning.slice(learning.indexOf("if (kind === \"edit\")"), learning.indexOf("if (!material.draft.trim()) return null;"));
  for (const field of ["category", "draft", "coachReply", "coachNote"]) c.ok(material.includes(field + ":"), `Learner material: ${field}`);
  c.ok(!/request|description|message:/.test(material.replace(/data\.message|rejected\?\.message|preferred\?\.message/g, "")), "Learner material: no member message");
  c.ok(/draft: withoutName\(material\.draft, names\)/.test(learning), "Learner material: names removed");
  c.ok(/const edit = \/\^\\\/api\\\/v1\\\/exceptions\\\/\(\[\^\/\]\+\)\\\/corrections\$\/\.exec\(path\);/.test(learning) && /if \(!exception\?\.data\?\.decisionId\) return;/.test(learning), "an edit to a held draft queues the Learner");
  c.ok(/row\.data\.type === "escalation"[^\n]*\) return null;/.test(src("apps/api/src/trainer-preview-review.ts")), "a Try my AI escalation stays held for you");
  for (const t of full.traces) c.ok(!("verify" in t), `${t.id}: no open verify item`);
  for (const t of full.traces) for (const side of ["memberSees", "trainerSees"]) if (t[side]) c.ok(typeof t[side].verbatim === "boolean", `${t.id}.${side}.verbatim settled`);
  c.done();
});

test("safety rules: categories computed by the real rules, highlighted words that trigger alone, nine categories", () => {
  const c = checks();
  c.eq(RED_FLAG_CATEGORIES.length, 9, "nine safety categories");
  for (const t of d.traces.filter((t: any) => t.channel === "chat")) {
    const got = redFlagCategories(t.trigger.text);
    const f = t.steps.find((s: any) => s.sp === "safety" && s.fn);
    const want = f ? f.fn.match(/\[(.*)\]/)![1].split(",").map((x: string) => x.trim()).filter(Boolean) : [];
    c.eq(got, want, `${t.id} redFlagCategories`);
    if (t.decide === "floor") c.ok(got.length > 0, `${t.id} safety stop`);
    else c.eq(got, [], `${t.id} routine for safety`);
    for (const w of f?.highlight || []) {
      const toks = t.trigger.text.split(/\s+/);
      let hit = false;
      for (let i = 0; i < toks.length && !hit; i++)
        for (let j = i + 1; j <= Math.min(toks.length, i + 8) && !hit; j++) {
          const ph = toks.slice(i, j).join(" ");
          if (ph.includes(w) && redFlagCategories(ph).some((x: string) => got.includes(x as any))) hit = true;
        }
      c.ok(hit && t.trigger.text.includes(w), `${t.id} highlight "${w}" sits in a sub-phrase that triggers alone`);
    }
  }
  c.done();
});

test("plan maths: decide() equals planConfidence() and planRoute() across 2000 combinations (every slider position)", () => {
  const c = checks();
  const seg = { goal: "strength", experience: "intermediate", daysPerWeek: 4, equipment: [] as string[] };
  let combos = 0;
  for (const id of ["t8", "t10"]) {
    const t = d.trace(id), g = t.sure.signals, ad = g.logged !== undefined;
    for (const bar of Array.from({ length: 50 }, (_, i) => 50 + i)) // every slider position, 50–99
      for (const eqr of [false, true])
        for (const more of [false, true])
          for (const logged of ad ? [1, 0.75, 0.5, 0.25] : [1])
            for (const mode of ["automatic", "supervised"]) {
              const s = settings({ bar, addEquipmentRule: eqr, oneMoreApproved: more, loggedShare: logged, planMode: mode });
              const mine = core.planScore(t, s);
              const rules = eqr ? 1 : g.rules;
              const learning = [...Array(g.cases.approved + (more ? 1 : 0))].map(() => ({ decision: "approved", segment: seg, type: ad ? "adaptation" : "programme" }));
              const conf = planConfidence({
                ruleCoverage: { score: rules, facets: { goal: true, experience: true, equipment: rules === 1, schedule: true, progression: true } } as any,
                caseCoverage: caseCoverage(seg as any, learning as any, ad ? "adaptation" : "programme"),
                validation: { errors: [], warnings: g.checks.list, metrics: { exerciseCount: 8, taggedExercises: 8 * g.library, untaggedExercises: [] } } as any,
                selfConfidence: g.model, uncertainties: [], threshold: bar / 100, ...(ad ? { outcomeEvidence: logged } : {}),
              } as any);
              const route = planRoute({ type: ad ? "adaptation" : "programme", mode: mode as any, qualified: true, safety: [], confidence: conf, validation: { errors: [], warnings: g.checks.list, metrics: { exerciseCount: 8, taggedExercises: 8, untaggedExercises: [] } } as any, equipment: "full gym" } as any);
              const tag = `${id} bar ${bar} eq ${eqr} more ${more} logged ${logged} ${mode}`;
              c.eq(mine.score, conf.score, tag + " score");
              c.eq(mine.auto, route.route === "automatic", tag + " route");
              c.eq(mine.reasons, route.reasons, tag + " reasons");
              // Whole percents as the app shows them, except where rounding would reach the bar the score misses.
              const whole = Math.round(conf.score * 100);
              c.eq(mine.pct, whole < bar || mine.confident ? whole : Math.min(Math.round(conf.score * 1000) / 10, bar - 0.1), tag + " % rounding");
              c.eq(mine.pct >= bar, mine.confident, tag + " the % shown agrees with the lane");
              c.eq(core.decide(t, s, d).lane, route.route === "automatic" ? "sent" : "waits", tag + " lane");
              combos++;
            }
  }
  c.eq(combos, 2000, "plan combinations");
  // A score that rounds up to the bar it misses shows its decimal: never "75% is below your bar of 75%".
  for (const [patch, pct] of [[{ bar: 75, oneMoreApproved: true, loggedShare: 0.5 }, 74.8], [{ bar: 71, addEquipmentRule: true, loggedShare: 0.5 }, 70.5]] as const) {
    const r = core.decide(d.trace("t8"), settings(patch), d);
    c.eq([r.lane, r.sure.pct, r.sure.display, r.why], ["waits", pct, `${pct}% · your bar ${patch.bar}%`, `${pct}% is below your bar of ${patch.bar}%.`], `t8 ${JSON.stringify(patch)}`);
    c.ok(!new RegExp(`(\\d+)% · your bar \\1%`).test(r.sure.display), "no tie on display");
  }
  c.eq(core.planScore(d.trace("t8"), settings()).score, 0.78, "t8 0.78");
  c.eq(core.planScore(d.trace("t10"), settings()).score, 0.862, "t10 0.862");
  c.eq(core.decide(d.trace("t10"), settings({ bar: 86 }), d).lane, "sent", "86% passes 0.862");
  c.eq(core.decide(d.trace("t10"), settings({ bar: 87 }), d).lane, "waits", "87% does not");
  const base8 = core.planScore(d.trace("t8"), settings());
  c.eq(base8.reasons, d.trace("t8").reasons, "t8 reasons in JSON match the app's wording");
  c.eq(base8.display, d.trace("t8").sure.display, "t8 display");
  c.eq(core.planScore(d.trace("t10"), settings()).display, d.trace("t10").sure.display, "t10 display");
  // The Checker's plan limits are the app's defaults.
  const bounds = planBoundsSchema.parse({});
  const limits = d.trace("t10").steps.map((s: any) => s.say).join(" ");
  c.ok(limits.includes(`Sessions ${bounds.maxSessionMinutes} min or less ✓ · Rests ${bounds.minRestSeconds}–${bounds.maxRestSeconds} s ✓`), "t10 plan limits");
  c.ok(d.trace("t8").steps.some((s: any) => s.say.includes(`your limit ${bounds.maxLoadJumpPct}% ✓`)), "t8 load jump limit");
  c.done(2400);
});

test("voice and recovery maths: reducedLoad() and reduceWhoopWorkout()", () => {
  const c = checks();
  for (let p = 0; p <= 20; p++) c.eq(core.reducedLoad(60, p), domainReducedLoad(60, { tooHeavyReducePercent: p } as any), `reducedLoad 60 kg ${p}%`);
  c.eq(core.decide(d.trace("t5"), settings(), d).memberSees.parts[0].text, `Lighter weight for the next set: ${formatLoad(54)} kilograms.`, "t5 54 kg");
  const w = d.trace("t3").inputs.workout;
  let whoop = 0;
  for (let L = 0; L <= 30; L += 5)
    for (let V = 0; V <= 50; V += 5) {
      const prog = { exercises: w.map((e: any) => ({ ...e, alternatives: e.alt ? [e.alt] : [] })) };
      const dom: any[] = (reduceWhoopWorkout(prog as any, { loadPercent: L, volumePercent: V }) as any).program.exercises;
      core.reduceWorkout(w, L, V).forEach((e: any, i: number) => {
        for (const k of ["loadKg", "reps", "durationSeconds", "distanceMeters"]) c.eq(e[k], dom[i][k], `whoop L${L} V${V} ${e.name}.${k}`);
        if (e.alt) c.eq(e.alt.loadKg, dom[i].alternatives[0].loadKg, `whoop L${L} V${V} alt`);
      });
      whoop++;
    }
  c.eq(whoop, 77, "WHOOP combinations");
  const on = settings(ON);
  c.eq(core.decide(d.trace("t3"), on, d).steps[1].detail, d.trace("t3").steps[1].detail, "t3 detail lines from reduceWhoopWorkout");
  for (const v of d.trace("t3").variants.filter((v: any) => v.detail))
    c.eq(core.decide(d.trace("t3"), { ...on, recoveryReading: v.when.recovery }, d).steps[1].detail.slice(0, -1), v.detail, `t3 variant ${v.when.recovery}`);
  c.done(1000);
});

test("decide() reproduces every lane and every variant, and the totals", () => {
  const c = checks();
  const on = settings(ON);
  for (const t of d.traces) c.eq(core.decide(t, on, d).lane, t.lane, `${t.id} default lane`);
  const VAR: Record<string, (s: any, v: any) => any> = {
    level: (s, v) => ({ ...s, level: v }), capPctBelow: (s, v) => ({ ...s, capPct: Math.floor(v) }), minRirAbove: (s, v) => ({ ...s, minRir: v + 1 }),
    recovery: (s, v) => ({ ...s, recoveryReading: v }), recoveryOn: (s, v) => ({ ...s, recoveryRule: v }), tooHeavyPct: (s, v) => ({ ...s, tooHeavyPct: v }),
    thresholdAtMost: (s, v) => ({ ...s, bar: Math.round(v * 100) }), thresholdAbove: (s, v) => ({ ...s, bar: Math.round(v * 100) + 1 }),
    addEquipmentRule: (s, v) => ({ ...s, addEquipmentRule: v }), oneMoreApproved: (s, v) => ({ ...s, oneMoreApproved: v }),
    loggedShare: (s, v) => ({ ...s, loggedShare: v }), planMode: (s, v) => ({ ...s, planMode: v }), supplementsTopic: (s, v) => ({ ...s, supplementsTopic: v }),
  };
  for (const t of d.traces)
    for (const v of t.variants) {
      const [key, val] = Object.entries(v.when)[0] as [string, any];
      c.ok(key in VAR, `${t.id} variant key ${key}`);
      if (!(key in VAR)) continue;
      const r = core.decide(t, VAR[key](on, val), d);
      c.eq(r.lane, v.lane, `${t.id} variant ${key}=${val} lane`);
      if (v.score) c.eq(r.sure.score, v.score, `${t.id} variant ${key} score`);
      if (v.memberSees && t.decide === "voice") c.eq(r.memberSees.parts[0].text, v.memberSees, `${t.id} variant ${key}=${val} line`);
    }
  c.ok(core.decide(d.trace("t1"), { ...on, capPct: 3 }, d).why.startsWith("2.5 kg is 4.2%, over your 3% cap."), "diff-line example");
  c.eq(core.totals(d, settings()), d.labels.totals.recoveryOff, "totals, recovery flag off");
  c.eq(core.totals(d, on), d.labels.totals.recoveryOn, "totals, recovery flag on");
  c.done(20);
});

// Number words the copy uses.
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
test("claims the pages and the showcases share hold in the code (28 days, the 5% cap, seven specialists, nine kinds, the setup numbers)", () => {
  const c = checks();
  // Wherever a claim appears (the traces, the engine's copy, the registry),
  // its number is the code's.
  const engine = "apps/web/components/marketing/brain/engine/";
  const engineFiles = ["core", "decide", "ui", "data", "field.render", "field", "receipt", "play.render", "play", "anatomy.render", "anatomy"]
    .map((f) => engine + f + ".js")
    .filter((f) => existsSync(repo(f)));
  const corpus = [fullText, ...engineFiles.map(src), JSON.stringify(MARKETING_CONTENT), JSON.stringify(AVAILABILITY_LINES)].join("\n");
  const every = (re: RegExp) => [...corpus.matchAll(re)];
  const number = (word: string) => WORDS[word.toLowerCase()] ?? Number(word);

  c.ok(every(/\b(\w+) kinds, in English and Arabic/gi).every((m) => number(m[1]) === RED_FLAG_CATEGORIES.length), "N kinds, in English and Arabic");

  const twin = src("apps/api/src/client-twin.ts");
  c.eq(twin.match(/created_at>=now\(\)-interval '28 days'/g)?.length, 2, "the client memory reads 28 days of workouts and sets");
  c.ok(d.sp.memory.line.includes("the last 28 days of training"), "Memory: the last 28 days");
  for (const m of every(/\blast (\d+) days\b/gi)) c.eq(Number(m[1]), 28, m[0]);

  const t1 = d.trace("t1"), r1 = core.decide(t1, settings(), d);
  const increase = ((t1.inputs.increaseKg / t1.inputs.loadKg) * 100).toFixed(1);
  c.eq([increase, settings().capPct, r1.lane], ["4.2", 5, "sent"], "t1: +2.5 kg is 4.2%, inside the 5% cap, sent on its own");
  c.ok(r1.steps.find((s: any) => s.sp === "rule_finder").detail.includes(`Increase ${increase}%, your cap ${settings().capPct}% ✓`), "t1 rule finder line");
  for (const m of every(/(\d+(?:\.\d+)?)%, inside your (\d+)% cap/g)) c.eq([m[1], Number(m[2])], [increase, settings().capPct], m[0]);

  const coach = d.specialists.filter((s: any) => s.crew === "coach" && s.kind === "ai");
  c.eq(coach.length, 7, "seven coaching specialists");
  // How many are not on yet follows the flags (anatomy.render.js note()); the Meal planner waits for nutrition.
  c.eq(coach.filter((s: any) => s.status === "not_on_yet").map((s: any) => s.name), [], "every one of them runs once its flags are on");
  c.eq(d.sp.meal_planner.needs, "nutrition", "the Meal planner needs nutrition");
  for (const m of every(/\b(\w+) coaching specialists/gi)) c.eq(number(m[1]), coach.length, m[0]);

  const dimensions = src("apps/web/components/brain-fidelity.tsx").match(/const dimensions = \[([\s\S]*?)\] as const;/)![1].match(/\["\w+", "[^"]+"\]/g)!;
  c.eq(dimensions.length, 5, "Compare my replies rates five dimensions");
  for (const m of every(/\bon (\w+) points\b/gi)) c.eq(number(m[1]), dimensions.length, m[0]);

  c.eq(SETUP_BRAIN_MINIMUM, { quiz: 8, own: 3 }, "8 answers and 3 cases");
  c.eq([OWN_CASES_FOR_SUPERVISED, OWN_CASES_FOR_FULL_CHECK], [3, 20], "3 cases to start, 20 for automatic sending");
  const brainStep = SETUP_STEPS.find((s) => s.key === "brain")!;
  c.eq(brainStep.minutes, 6, "about 6 minutes to teach the Brain");
  for (const m of every(/\b(\d+) (?:confirmed )?(?:quiz )?answers and (\d+) (?:own |client )?cases\b/gi)) c.eq([Number(m[1]), Number(m[2])], [8, 3], m[0]);
  // "8 quiz answers and 3 cases." is the setup minimum, checked above.
  for (const m of every(/(?<!answers and )\b(\d+)\+? (?:of your own )?cases(?= and passing| for automatic|\.)/gi)) c.eq(Number(m[1]), OWN_CASES_FOR_FULL_CHECK, m[0]);
  for (const m of every(/\babout (\d+) minutes for the first/gi)) c.eq(Number(m[1]), brainStep.minutes, m[0]);

  // "Approve all" leaves flagged drafts out, in the API and on screen.
  const card = (id: string, warning: boolean): RuleCard => ({ id, version: 1, status: "draft", title: id, flags: warning ? ["medical_advice"] : [], warning });
  const groups = ruleGroups([card("clean", false), card("flagged", true)]);
  c.eq([groups.clean.map((x) => x.id), groups.flagged.map((x) => x.id)], [["clean"], ["flagged"]], "flagged drafts are listed one by one");
  c.ok(/approveAll: s\.drafts\s+\.filter\(\(r\) => !r\.data\.flags\?\.length\)/.test(src("apps/api/src/brain-teach.ts")), "the API's Approve all list leaves flagged drafts out");
  c.ok(src("apps/web/components/setup-brain.tsx").includes("Approve all {clean.length}"), "the button counts the clean drafts");
  c.ok(d.sp.rule_writer.signsOff.includes("Flagged drafts are never in Approve all."), "Rule writer: flagged drafts are never in Approve all");
  c.done(20);
});

test("every specialist's code reference names a file that exists and contains it", () => {
  const c = checks();
  for (const s of full.specialists)
    for (const ref of s.code.split(";").map((x: string) => x.trim())) {
      const m = ref.match(/^(.+) · ((?:apps|packages)\/[\w./-]+\.(?:ts|tsx|sql))$/);
      c.ok(m, `${s.id}: "${ref}" is "identifier · repo path"`);
      if (!m) continue;
      c.ok(existsSync(repo(m[2])), `${s.id}: ${m[2]} exists`);
      if (existsSync(repo(m[2]))) c.ok(src(m[2]).includes(m[1]), `${s.id}: ${m[2]} contains ${m[1]}`);
    }
  c.done(25);
});

test("the client copy is the canonical traces without internal fields; the brand is a token", () => {
  const client: any = JSON.parse(clientText);
  assert.equal(clientText, JSON.stringify(stripForClient(full)), "traces.client.json is stale: run node scripts/brain-traces.mjs");
  assert.equal(clientText, JSON.stringify(client), "minified");
  const keys = new Set<string>();
  (function walk(o: any) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") for (const k in o) keys.add(k), walk(o[k]);
  })(client);
  for (const k of ["code", "verify", "verbatim", "verbatimFrom", "verbatimRef", "fn", "refs", "basisCommit"]) assert.ok(!keys.has(k), `client copy has ${k}`);
  assert.doesNotMatch(clientText, /\b(?:apps|packages|tests|docs)\/[\w-]+/, "no repository paths");
  // No literal brand outside the format id, in either copy: a renamed platform shows its own name.
  for (const [where, text] of [["traces.json", fullText], ["traces.client.json", clientText]])
    assert.deepEqual([...text.replaceAll('"trainsyou-brain-trace@2"', "").matchAll(/trainsyou/gi)].length, 0, where);
  assert.equal([...fullText.matchAll(/\{APP_NAME\}/g)].length, 3, "the safety rules' source names the platform");
});

// The copy scans of the marketing tests (tests/marketing-site.test.ts and the
// model-name guard), over every visible string of the client copy.
const HYPE = /trusted by|as seen in|#1\b|guaranteed|passive income|revolutionary|the best\b|best-in-class|world-class|\d+\+? (trainers|coaches) (use|trust)|★/i;
const HYPE_WORDS = /seamless|revolutionary|cutting-edge|unlock|empower|game-changing/i;
const PAYOUT_PROVIDER = /\bLean\b/;
const AI_COST = /\bAI (usage|costs?)\b|at cost|passed (through|on)|usage cost|voice usage|model costs?/i;
const HIDDEN_SPECIALTIES = /\b(combat|endurance|yoga|pilates|boxing|martial arts|marathon)\b/i;
test("every visible string of the client copy passes the marketing copy scans", () => {
  const client: any = JSON.parse(clientText);
  const visible: Array<[string, string]> = [];
  (function walk(o: any, path: string, key: string) {
    if (typeof o === "string") {
      if (!NON_TEXT_KEYS.includes(key)) visible.push([path, o]);
    } else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`, key));
    else if (o && typeof o === "object") for (const k in o) walk(o[k], `${path}.${k}`, k);
  })(client, "", "");
  assert.ok(visible.length > 400, `${visible.length} visible strings`);
  for (const [path, text] of visible) {
    assert.doesNotMatch(text, MODEL_OR_VENDOR, path);
    assert.doesNotMatch(text, /\bSeed\b/, path);
    assert.doesNotMatch(text, HYPE, path);
    assert.doesNotMatch(text, HYPE_WORDS, path);
    assert.doesNotMatch(text, PAYOUT_PROVIDER, path);
    assert.doesNotMatch(text, AI_COST, path);
    assert.doesNotMatch(text, HIDDEN_SPECIALTIES, path);
    assert.doesNotMatch(text, PLACEHOLDER, path);
    for (const { term, instead } of C0_BANNED) assert.doesNotMatch(text, term, `${path}: write "${instead}"`);
  }
  // The skipped keys hold identifiers only (the flags' setting names joined
  // by &&), so no copy hides behind them.
  (function walk(o: any, key: string) {
    if (typeof o === "string") {
      if (NON_TEXT_KEYS.includes(key)) assert.match(o, /^[\w@.:-]+(?: && [\w@.:-]+)*$/, `${key}: ${o}`);
    } else if (Array.isArray(o)) o.forEach((v) => walk(v, key));
    else if (o && typeof o === "object") for (const k in o) walk(o[k], k);
  })(client, "");
});

test("the strip and every status follow the flags (prepare): payments, voice, nutrition and the AI model", () => {
  const raw: any = JSON.parse(clientText);
  const at = (flags: object) => prepare(raw, { appName: "trainsyou", flags: { ...OFF, ...flags } }) as any;
  const ids = (x: any, status: string) => [...x.specialists, ...x.traces].filter((s: any) => s.status === status).map((s: any) => s.id.split("-")[0]).sort();
  const NEEDS = ["meal_photo", "meal_planner", "set_logger", "t4", "t5", "voice_lines"];
  // Every status has its words, and a "not on yet" one no tip that says it runs.
  const words = (x: any) => {
    for (const s of [...x.specialists, ...x.traces]) {
      if (s.status === "try_yourself") assert.match(s.statusTip ?? s.statusNote ?? x.labels.statusTip.default, /\S/, `${s.id} says where it runs`);
      if (s.status !== "try_yourself") assert.equal(s.statusTip, undefined, `${s.id}: no "Try my AI" tip while ${s.status}`);
    }
  };
  // Payments off, voice and nutrition off: what needs them is not on yet, even in Try my AI; the rest is tried on yourself.
  const off = at({});
  assert.equal(off.labels.subscribers, d.labels.subscribers);
  assert.equal(off.labels.subscribersNoModel, undefined, "never shown as its own line");
  assert.match(strip(off), /class="sc-subs">Subscribers can&#39;t join yet: subscriber payments are not on\. You can run most of this on yourself with Try my AI\./);
  assert.deepEqual(ids(off, "not_on_yet"), [...NEEDS, "recovery", "t3"].sort());
  assert.deepEqual(ids(off, "try_yourself"), ["draft_writer", "plan_writer", "reply_picker", "t1", "t10", "t6", "t7", "t8", "t9", "week_reviewer"]);
  words(off);
  // Payments on: the strip goes and the rest is live; what needs voice or nutrition is still not on yet.
  const paid = at({ payments: true });
  assert.equal(paid.labels.subscribers, undefined);
  assert.doesNotMatch(strip(paid), /sc-subs|Subscribers can/);
  assert.deepEqual(ids(paid, "try_yourself"), []);
  assert.deepEqual(ids(paid, "not_on_yet"), ids(off, "not_on_yet"));
  words(paid);
  // Voice and nutrition on: their specialists and moments join, tried on yourself until payments are on.
  const early = at({ voice: true, nutrition: true });
  assert.deepEqual(ids(early, "not_on_yet"), ["recovery", "t3"]);
  assert.deepEqual(ids(early, "try_yourself"), [...ids(off, "try_yourself"), ...NEEDS].sort());
  words(early);
  assert.deepEqual(ids(at({ payments: true, voice: true, nutrition: true }), "not_on_yet"), ["recovery", "t3"]);
  assert.deepEqual(ids(at({ payments: true, voice: true }), "not_on_yet"), ["meal_photo", "meal_planner", "recovery", "t3", "t4"]);
  // The AI model off: every specialist that uses it and every moment one of them plays is not on yet, whatever
  // else is on; code steps and the safety stops stay; the strip says only that payments are off.
  for (const flags of [{ model: false }, { model: false, payments: true, voice: true, nutrition: true }]) {
    const x = at(flags);
    const ai = x.specialists.filter((s: any) => s.kind === "ai" || s.usesAi);
    assert.ok(ai.length >= 15 && ai.every((s: any) => s.status === "not_on_yet"), JSON.stringify(flags));
    for (const t of x.traces) assert.equal(t.status === "not_on_yet", t.steps.some((st: any) => ai.some((s: any) => s.id === st.sp)) || t.id.startsWith("t3-"), `${t.id} ${JSON.stringify(flags)}`);
    assert.deepEqual(["t2", "t11", "t12"].map((id) => x.trace(id).status), ["live", "live", "live"]);
    assert.ok(x.specialists.filter((s: any) => s.kind === "check" && !s.usesAi && s.status === "not_on_yet").every((s: any) => ["recovery", "set_logger"].includes(s.id)));
    words(x);
  }
  assert.equal(at({ model: false }).labels.subscribers, d.labels.subscribersNoModel);
  assert.match(strip(at({ model: false })), /class="sc-subs">Subscribers can&#39;t join yet: subscriber payments are not on\.<\/span>/);
  assert.equal(at({ model: false, payments: true }).labels.subscribers, undefined);
  // A fixture without the model flag counts it on (showcaseOptions() always passes it).
  const statuses = (x: any) => JSON.stringify({ ...x, flags: null });
  assert.equal(statuses(at({ model: true })), statuses(off));
  // The lanes never depend on the flags (recovery aside).
  for (const x of [paid, early, at({ model: false })]) assert.equal(core.totals(x, core.defaults(x)), core.totals(off, core.defaults(off)));
});

test("Aisha's adjustment sent on its own shows the member the app's notice, word for word; while it waits she sees nothing yet", () => {
  const t8 = d.trace("t8"), notice = "Your trainer's Brain adjusted next week's sessions from how this week went. Open Training to see them.";
  const templates = src("apps/api/src/message-templates.ts"), plans = src("apps/api/src/brain-plans.ts");
  assert.ok(templates.includes(`body: "${notice}"`) && plans.includes(`"${notice}"`), "the brain-plan-adjusted notice");
  for (const v of t8.variants.filter((x: any) => x.lane === "sent")) assert.equal(v.memberSees, notice, JSON.stringify(v.when));
  for (const patch of [{ bar: 78 }, { addEquipmentRule: true }, { oneMoreApproved: true }]) {
    const r = core.decide(t8, settings(patch), d);
    assert.equal(r.lane, "sent", JSON.stringify(patch));
    assert.deepEqual(r.memberSees, { verbatim: true, parts: [{ by: "platform", text: notice }] }, JSON.stringify(patch));
  }
  assert.equal(core.decide(t8, settings(), d).memberSees, null, "waits: nothing yet");
  assert.equal(core.decide(d.trace("t10"), settings({ bar: 87 }), d).memberSees, null, "Fatima's first plan waits: nothing yet");
});

test("prepare() is pure: it copies, fills the name and flags, and never changes its input", () => {
  const raw: any = JSON.parse(clientText);
  const before = JSON.stringify(raw);
  const run = (appName: string, payments: boolean) => JSON.stringify(prepare(raw, { appName, flags: { ...OFF, payments } }));
  const first = run("trainsyou", false);
  const acme = run("Acme", false);
  assert.match(acme, /"Acme\. Can't switch off\."/);
  assert.doesNotMatch(acme, /trainsyou\. Can't switch off|\{APP_NAME\}/);
  assert.equal(run("trainsyou", false), first, "trainsyou → Acme → trainsyou");
  assert.notEqual(run("trainsyou", true), first);
  assert.equal(run("trainsyou", false), first, "payments off → on → off");
  assert.equal(JSON.stringify(raw), before, "the imported JSON is unchanged");
  // An indexed input (index() caches lookups on it) prepares the same way.
  assert.equal(JSON.stringify(prepare(index(JSON.parse(clientText)), { appName: "trainsyou", flags: OFF })), first);
  // A name with replacement patterns is inserted as written.
  assert.match(JSON.stringify(prepare(raw, { appName: "$& Co", flags: OFF })), /"\$& Co\. Can't switch off\."/);
});
