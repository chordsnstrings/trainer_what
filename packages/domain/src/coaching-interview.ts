import { z } from "zod";
import type { ChatData } from "./onboarding-chat.ts";

/** Coverage records what the coach has explained, never whether the Brain is qualified. */
export const coachingMethods = ["crossfit", "strength", "hypertrophy", "endurance", "mobility", "sport", "other"] as const;
type Method = typeof coachingMethods[number];
type Point = { id: string; question: string };
type Topic = { id: string; title: string; method?: Method; points: Point[] };
const topic = (id: string, title: string, questions: Record<string, string>, method?: Method): Topic => ({
  id, title, ...(method ? { method } : {}), points: Object.entries(questions).map(([key, question]) => ({ id: id + "." + key, question })),
});
export const coachingTopics: Topic[] = [
  topic("philosophy", "Training philosophy", {
    priorities: "What matters most in the way you train people, and why?",
    tradeoffs: "When a client's short-term goal clashes with your training philosophy, how do you decide what to prioritise?",
  }),
  topic("methods", "Your training methods", {
    choice: "Which training styles do you actually use with clients, and what makes you choose one over another?",
  }),
  topic("assessment", "Starting a client", {
    baseline: "What do you look at in a new client's first assessment before you write their programme?",
    placement: "How do those findings change where a beginner or an experienced client starts?",
  }),
  topic("weekly", "The training week", {
    split: "How do you normally split a client's training across the week, and why does that split suit them?",
    frequency: "How would you change that week for someone who can train only twice, compared with someone who can train five times?",
  }),
  topic("session", "Session structure", {
    sequence: "Walk me through how you divide a typical session, from warming up to finishing, including the time for each part?",
    order: "How do you decide the order of skill work, main lifts, accessories and conditioning when several belong in one session?",
  }),
  topic("exercise", "Exercise selection", {
    selection: "Which movements do you build programmes around, and what makes an exercise right for a particular client?",
    alternatives: "If a client can't perform or dislikes a chosen exercise, how do you select a replacement that keeps its purpose?",
  }),
  topic("dosage", "Sets, reps and intensity", {
    prescription: "How do you choose working sets, reps and effort or load for a client's goal and experience?",
    execution: "What are your rules for rest, tempo and technique, and when do you change them?",
  }),
  topic("progression", "Progression and plateaus", {
    advance: "What exactly tells you to increase load, reps or difficulty, and how big a change do you make?",
    plateau: "When progress stalls, how do you work out the cause and decide what to change first?",
  }),
  topic("blocks", "Training blocks and deloads", {
    planning: "How do you organise training into blocks over several weeks, and what changes from one block to the next?",
    deload: "What makes you schedule a deload, and how do you change training during it?",
  }),
  topic("recovery", "Recovery and missed training", {
    readiness: "What do you change on a day when a client's sleep, stress or fatigue is worse than usual?",
    return: "How do you rebuild the schedule and workload after a client misses a week or more?",
  }),
  topic("constraints", "Making training fit real life", {
    time: "If a client has half their usual session time, what do you keep, shorten or leave out, and why?",
    equipment: "How do you adapt your usual training when the client has limited equipment or is travelling?",
  }),
  topic("communication", "How you coach", {
    cues: "What cues and feedback do you use when a client struggles with a movement? An example in your own words would help.",
    adherence: "How do you respond when motivation or consistency drops, in the words you would actually use with that client?",
  }),
  topic("tracking", "Measuring progress", {
    measures: "Which results and session details do you track to know whether your programme is working?",
    reviews: "How often do you review those results, and what would make you change the plan rather than stay with it?",
  }),
  topic("boundaries", "Your coaching boundaries", {
    stop: "What would make you stop a session and refer the client to a qualified professional?",
    handover: "Which decisions may your AI draft from your rules, and which must always come back to you?",
  }),
  topic("nutrition_role", "The role of nutrition", {
    scope: "What role, if any, does nutrition have in your coaching, and where do you draw the line on the help you provide?",
  }),
  topic("week_example", "A worked training week", {
    plan: "Describe a full example week for a typical client: their goal, level, days, and what they do each day? Please leave out identifying details.",
    reasoning: "Why did you arrange that example week that way, and what would you change as the client progresses?",
  }),
  topic("session_example", "A worked session", {
    plan: "Take one day from that week and walk me through the actual exercises, sets, reps, load or effort, rest and timing you would prescribe?",
    adaptation: "How would that exact session change for a less experienced client, or one having a low-energy day?",
  }),
  topic("case_reasoning", "Your decisions in practice", {
    decision: "Tell me about an anonymous client situation where your first plan didn't work: what did you notice, change, and learn?",
    reply: "What would you actually say to that client to explain the change and check that it worked for them?",
  }),
  topic("crossfit_stimulus", "CrossFit workout intent", {
    design: "When programming a CrossFit workout, how do you choose its intended stimulus, format, time domain and time cap?",
    pacing: "How do you decide the right load and pacing so the athlete gets that stimulus rather than just finishing the workout?",
  }, "crossfit"),
  topic("crossfit_scaling", "CrossFit scaling", {
    movements: "How do you scale gymnastics, barbell and conditioning movements while preserving the purpose of a CrossFit workout?",
    example: "Give me one CrossFit workout with its intended stimulus, then show how you'd scale it for a beginner and an experienced athlete?",
  }, "crossfit"),
  topic("crossfit_balance", "CrossFit skills and strength", {
    week: "How do you balance strength, Olympic lifting skills, gymnastics and metcons across a CrossFit week without stacking too much fatigue?",
    progress: "How do you decide when an athlete is ready for a harder skill or load, and which benchmarks do you use to check progress?",
  }, "crossfit"),
  topic("strength_heavy", "Heavy strength work", {
    loading: "For heavy sets, how do you choose reps, working weight and an RPE or reps-in-reserve target for the main lift?",
    sets: "How do you organise warm-up ramps, top sets, back-off sets and rest periods on a heavy day?",
  }, "strength"),
  topic("strength_support", "Supporting the main lifts", {
    assistance: "How do you choose assistance work for a weak point without taking too much recovery away from the heavy lifts?",
    fatigue: "What do you do when bar speed, technique or completed reps deteriorate during a heavy session?",
  }, "strength"),
  topic("strength_cycles", "Strength cycles and testing", {
    cycle: "How do volume and intensity change across your strength cycle, including what happens when a lifter stalls?",
    testing: "When, if ever, do you test or peak maximal strength, and how do you prepare and judge readiness for it?",
  }, "strength"),
  topic("hypertrophy_volume", "Muscle-building volume", {
    allocation: "How do you set weekly hard sets and frequency for each muscle, including muscles a client wants to prioritise?",
    adjustment: "What tells you to add or reduce volume for a particular muscle rather than just push harder?",
  }, "hypertrophy"),
  topic("hypertrophy_effort", "Hypertrophy effort and selection", {
    failure: "How close to failure do you take different exercises, and when would you avoid or use failure training?",
    selection: "How do you choose and order compound and isolation exercises to train the target muscle effectively?",
  }, "hypertrophy"),
  topic("hypertrophy_progress", "Hypertrophy progression", {
    progression: "How do you progress reps and load within your chosen rep ranges while keeping technique consistent?",
    example: "Walk me through a muscle-priority session, including working sets, reps, rest and the effort you expect?",
  }, "hypertrophy"),
  topic("endurance_week", "Endurance programming", {
    balance: "How do you distribute easy work, long sessions and harder intervals across an endurance week?",
    intensity: "How do you set intensity using pace, heart rate or perceived effort, and adapt it when those measures disagree?",
  }, "endurance"),
  topic("endurance_load", "Endurance load and recovery", {
    build: "How do you progress distance, duration and intensity without increasing everything at once?",
    support: "Where do strength work, cross-training and recovery fit around the key endurance sessions?",
  }, "endurance"),
  topic("endurance_event", "Endurance goals and events", {
    event: "How does your plan change as a target race or endurance goal approaches, including tapering if you use it?",
    example: "Describe a key endurance workout you would prescribe, including its purpose, intervals, intensity and recovery?",
  }, "endurance"),
  topic("mobility_method", "Mobility and movement practice", {
    assessment: "How do you assess a client's movement control and usable range before choosing mobility or movement work?",
    selection: "How do you decide between active range work, loaded mobility, stretching or a movement sequence for that client?",
  }, "mobility"),
  topic("mobility_progress", "Movement progression", {
    progression: "How do you progress range, control, holds or resistance, and distinguish useful effort from a reason to stop?",
    example: "Walk me through a mobility or movement session with its goal, sequence, timing and easier variations?",
  }, "mobility"),
  topic("sport_demands", "Sport-specific planning", {
    demands: "How do the sport, playing role and competition calendar shape the physical qualities you prioritise?",
    season: "How does your training week change in-season compared with the off-season, around practice and matches?",
  }, "sport"),
  topic("sport_transfer", "Transfer to sport", {
    selection: "How do you choose strength, power, speed and conditioning work that transfers to the athlete's sport?",
    example: "Describe a sport-specific session and how you adjust its workload around a competition?",
  }, "sport"),
  topic("custom_method", "The details of your method", {
    principles: "For the training method you've described, which specific principles determine how you design a workout?",
    progression: "What does progression look like in that method, and what tells you a client is ready for it?",
  }, "other"),
  topic("custom_example", "Your method in practice", {
    example: "Show me a characteristic workout from your method, including the purpose, sequence, workload and timing?",
    scaling: "How would you adapt that workout for someone new to the method while keeping its intended benefit?",
  }, "other"),
];
const points = new Map(coachingTopics.flatMap(t => t.points.map(p => [p.id, p] as const)));
const quote = z.string().trim().min(1).max(1200);
export const coachingUpdateSchema = z.object({
  answers: z.array(z.object({ point: z.string().max(60), evidence: quote }).strict()).max(16).nullish(),
  methods: z.object({ selected: z.array(z.enum(coachingMethods)).min(1).max(7), evidence: quote }).strict().nullish(),
  defer: z.object({ point: z.string().max(60), evidence: quote }).strict().nullish(),
}).strict();
export type CoachingUpdate = z.infer<typeof coachingUpdateSchema>;
type Evidence = { evidence: string; messageId: string; at: string; sourceIds: string[] };
export type CoachingInterview = { version: 1; answers: Record<string, Evidence>; methods?: Evidence & { selected: Method[] } };
const normal = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, " ").trim();
const vague = /^(yes|no|ok(ay)?|sure|same|(it )?depends( on the client)?|whatever works|keep it safe|i (don't|do not) know|not sure|tell me more|what do you mean|which (part|one|question) should i answer( first)?)[.!?\s]*$/i;
function supported(evidence: string, material: string, detail = true) {
  return evidence.trim().length >= (detail ? 12 : 3) && normal(material).includes(normal(evidence)) && !vague.test(evidence.trim());
}
export const coachingField = (point: string) => "coaching." + point;
export function activeCoachingTopics(c: ChatData) {
  const methods = new Set(c.interview?.methods?.selected ?? []);
  const core = coachingTopics.filter(t => !t.method);
  // Put the relevant specialist questions beside weekly/session design, not at the end of a generic interview.
  return [...core.slice(0, 5), ...coachingTopics.filter(t => t.method && methods.has(t.method)), ...core.slice(5)];
}
export function nextCoachingQuestion(c: ChatData) {
  for (const t of activeCoachingTopics(c)) for (const p of t.points) {
    if (!c.interview?.answers[p.id] && !c.skipped.includes(coachingField(p.id))) return { field: coachingField(p.id), text: p.question };
  }
  return null;
}
/** Only current, verbatim evidence can cover a point. No counts of messages/rules substitute for answers. */
export function mergeCoachingInterview(c: ChatData, update: CoachingUpdate | undefined, material: string, messageId: string, at: string, sourceIds: string[]) {
  if (c.audience !== "coach" || !update) return;
  const interview: CoachingInterview = c.interview ?? { version: 1, answers: {} };
  const record = (evidence: string): Evidence => ({ evidence, messageId, at, sourceIds: [...new Set(sourceIds)] });
  if (sourceIds.length && update.methods && supported(update.methods.evidence, material, false))
    interview.methods = { ...record(update.methods.evidence), selected: [...new Set(update.methods.selected)] };
  c.interview = interview;
  const active = new Set(activeCoachingTopics(c).flatMap(t => t.points.map(p => p.id)));
  for (const answer of update.answers ?? []) {
    if (!sourceIds.length || !active.has(answer.point) || !supported(answer.evidence, material)) continue;
    // Knowing a style's name is not an explanation of why/how it is used.
    if (answer.point === "methods.choice" && !interview.methods) continue;
    interview.answers[answer.point] = record(answer.evidence);
    c.skipped = c.skipped.filter(k => k !== coachingField(answer.point));
  }
  const defer = update.defer;
  if (defer && points.has(defer.point) && c.lastQuestion?.field === coachingField(defer.point) && supported(defer.evidence, material, false) &&
      /\b(later|skip|not now|come back|another time)\b|لاحق|بعدين|تخط/i.test(defer.evidence)) {
    c.skipped = [...new Set([...c.skipped, coachingField(defer.point)])];
  }
}
export function coachingCoverage(c: ChatData) {
  const topics = activeCoachingTopics(c).map(t => {
    const covered = t.points.filter(p => c.interview?.answers[p.id]);
    const missing = t.points.filter(p => !c.interview?.answers[p.id]);
    return {
      id: t.id, title: t.title, covered: covered.length, total: t.points.length,
      status: missing.length === 0 ? "covered" : missing.every(p => c.skipped.includes(coachingField(p.id))) ? "deferred" : covered.length ? "partial" : "not_started",
      next: missing[0]?.question,
      notes: covered.map(p => ({ point: p.id, ...c.interview!.answers[p.id]! })),
    };
  });
  return { covered: topics.filter(t => t.status === "covered").length, total: topics.length, topics };
}
export type CoachingCoverage = ReturnType<typeof coachingCoverage>;
/** Bounded memory survives transcript archiving; all point IDs remain visible to the model. */
export function coachingInterviewContext(c: ChatData) {
  const answers = Object.entries(c.interview?.answers ?? {});
  const quoteLimit = Math.min(260, Math.max(40, Math.floor(3000 / Math.max(1, answers.length))));
  return {
    availableMethods: coachingMethods, methods: c.interview?.methods ? { selected: c.interview.methods.selected, evidence: c.interview.methods.evidence } : null,
    curriculum: coachingTopics.map(t => ({ title: t.title, method: t.method, points: t.points.map(p => c.interview?.answers[p.id] ? { id: p.id } : p) })),
    covered: Object.fromEntries(answers.map(([id, a]) => [id, a.evidence.slice(0, quoteLimit)])),
    deferred: c.skipped.filter(k => k.startsWith("coaching.")),
  };
}
