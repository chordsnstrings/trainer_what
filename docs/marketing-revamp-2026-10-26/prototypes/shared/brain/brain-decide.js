/* trainsyou Brain showcase · decide(): the lane for a trace under the
   trainer's settings. Pure; mirrors the app's own functions (verified by
   tools/verify.mts against packages/domain through tsx). */
import { clamp, flags } from "./brain-core.js";

/** Default settings for decide(): the sample trainer's choices. */
export function defaults(d) {
  const s = d.settingsDefault;
  return {
    level: s.level, lastCheckPassing: true, capPct: s.progression.capPct, minRir: s.progression.minRir,
    bar: Math.round(s.threshold * 100), planMode: s.planMode, addEquipmentRule: false, oneMoreApproved: false,
    loggedShare: 1, supplementsTopic: s.supplementsTopic, tooHeavyPct: s.tooHeavyPct,
    recoveryFlag: flags().recovery, recoveryRule: true, recoveryReading: 25,
    lowLoadPct: s.recovery.low.loadPct, lowVolumePct: s.recovery.low.volumePct,
  };
}
export const laneText = (d, lane) => d.labels.lanes[lane] || lane;
/** True for traces that must not play (t3 while its flag is off). */
export const isOff = (t, s) => !!t.defaultOff && !(s && s.recoveryFlag);
/** The one specialist code picked (id), or null when no AI is called. */
export function pick(t, d, s) {
  const r = s ? decide(t, s, d) : t;
  const st = r.steps.find((x) => x.sp in d.sp && d.sp[x.sp].kind == "ai" && x.sp != "learner");
  return st ? st.sp : null;
}

const half = (kg) => Math.max(0, Math.floor(kg * 2 + 1e-9) / 2);
/** voice-session.ts reducedLoad(): the lowest load a "too heavy" reply may set. */
export function reducedLoad(kg, pct) {
  if (!pct || kg <= 0) return null;
  const n = half(kg * (1 - pct / 100));
  return n < kg ? n : null;
}
const fmtKg = (kg) => (Number.isInteger(kg) ? String(kg) : String(Math.round(kg * 100) / 100));
/** whoop-training.ts reduceWhoopWorkout(), for the trace's sample workout. */
export function reduceWorkout(list, load, vol) {
  const red = (o, p, unit, min) => (typeof o != "number" || o <= min || p === 0 ? o
    : Math.min(o, Math.max(min, Math.ceil((o * (1 - p / 100)) / unit) * unit)));
  return list.map((e) => {
    const n = { ...e };
    n.loadKg = red(e.loadKg, load, 0.5, 0);
    n.reps = red(e.reps, vol, 1, 1);
    n.durationSeconds = red(e.durationSeconds, vol, 1, 5);
    n.distanceMeters = red(e.distanceMeters, vol, 10, 10);
    const changed = ["loadKg", "reps", "durationSeconds", "distanceMeters"].some((k) => n[k] !== e[k]);
    if (changed && e.alt && typeof e.alt.loadKg == "number")
      n.alt = { ...e.alt, loadKg: Math.min(e.alt.loadKg, Math.ceil(e.alt.loadKg * (1 - load / 100) * 2) / 2) };
    return n;
  });
}
/** planConfidence() + planRoute() reasons, from the trace's signals and settings. */
export function planScore(t, s) {
  const g = t.sure.signals, w = t.sure.weights, ad = g.logged !== undefined;
  const rules = s.addEquipmentRule ? 1 : g.rules;
  const c = { approved: g.cases.approved + (s.oneMoreApproved ? 1 : 0), edited: g.cases.edited, rejected: g.cases.rejected };
  const sig = {
    rules, cases: clamp((c.approved + c.edited * 0.75 - c.rejected) / 3, 0, 1),
    checks: Math.max(0, 1 - 0.2 * g.checks.warnings), library: g.library, model: clamp(g.model, 0, 1),
  };
  let score = ["rules", "cases", "checks", "library", "model"].reduce((a, k) => a + w[k] * sig[k], 0);
  const logged = ad ? clamp(s.loggedShare, 0, 1) : undefined;
  if (ad) score *= 0.7 + 0.3 * logged;
  score = Math.round(score * 1000) / 1000;
  const bar = s.bar / 100, confident = score >= bar, noun = ad ? "adjustment" : "plan";
  const why = [];
  if (rules < 1) why.push("Your confirmed rules and cases do not yet cover: " + (g.missing || []).join(", "));
  if (sig.cases < 1) why.push(`Few reviewed plans for similar clients (${c.approved} approved, ${c.edited} edited, ${c.rejected} rejected)`);
  for (const x of g.checks.list || []) why.push("Warning: " + x);
  if (sig.model < 0.7) why.push(`The model reported ${sig.model.toFixed(2)} confidence`);
  if (ad && logged < 0.7) why.push("Little logged training this week to adapt from");
  const auto = s.planMode == "automatic" && confident;
  const reasons = auto ? [] : [
    ...(s.planMode == "supervised" ? [`Supervised mode: every ${noun} goes to you`] : []),
    ...(!confident ? [`Confidence ${score.toFixed(2)} is below your threshold ${bar.toFixed(2)}`, ...why] : []),
  ];
  return { score, pct: Math.round(score * 100), bar: s.bar, confident, auto, reasons, display: `${Math.round(score * 100)}% · your bar ${s.bar}%` };
}
const swap = (st, sp, patch) => st.map((x) => (x.sp == sp ? { ...x, ...patch } : x));
const vr = (t, key) => (t.variants || []).find((v) => key in v.when) || {};
const member = (text) => ({ verbatim: true, parts: [{ by: "platform", text }] });
/** Pure: the lane and the steps for a trace under the given settings.
    Returns {lane, why, steps, memberSees, trainerSees, sure, reasons, tag, off}. */
export function decide(t, s, d) {
  const r = { lane: t.lane, why: null, steps: t.steps, memberSees: t.memberSees, trainerSees: t.trainerSees,
    sure: t.sure ? { display: t.sure.display, score: t.sure.score, bar: Math.round(t.sure.threshold * 100) } : null,
    reasons: t.reasons || null, tag: t.tileTag || null, note: t.laneNote || null, off: isOff(t, s) };
  const k = t.decide, lv = d.labels.levels;
  if (k == "chat_action") {
    const i = t.inputs, inc = (i.increaseKg / i.loadKg) * 100, capOk = inc <= s.capPct, rirOk = i.rir >= s.minRir;
    const fit = capOk && rirOk;
    r.steps = swap(t.steps, "rule_finder", {
      detail: [...t.steps.find((x) => x.sp == "rule_finder").detail.slice(0, 2),
        `Reps in reserve ${i.rir}, you need ${s.minRir} ${rirOk ? "✓" : "✗"}`,
        `Increase ${inc.toFixed(1)}%, your cap ${s.capPct}% ${capOk ? "✓" : "✗"}`],
      ...(fit ? {} : { result: "none", say: "No approved reply fits." }),
    });
    if (!fit) {
      const v = vr(t, capOk ? "minRirAbove" : "capPctBelow");
      r.why = capOk ? `He logged reps in reserve ${i.rir}. Your rule now needs ${s.minRir}, so no approved reply fits.`
        : `${i.increaseKg} kg is ${inc.toFixed(1)}%, over your ${s.capPct}% cap. No approved reply fits, so the Draft writer drafts one for you.`;
      r.steps = swap(swap(r.steps, "reply_picker", { sp: "draft_writer", result: "wrote", say: "Drafts a reply for you", out: null, basis: "illustrative" }),
        "lane_gate", { result: "waits", say: "A draft, so it waits for you." });
      r.steps = swap(r.steps, "checker", { say: "Uses only what it was shown ✓" });
      Object.assign(r, { lane: "waits", trainerSees: v.trainerSees, memberSees: member(v.memberSees) });
    } else if (s.level < 2 || !s.lastCheckPassing) {
      const v = vr(t, "level");
      r.why = s.level < 2 ? `Level 1: ${lv[1].summary}` : `Your last check did not pass, so it waits. ${lv.note}`;
      r.steps = swap(r.steps, "lane_gate", { result: "waits", say: s.level < 2 ? lv[1].summary : "Last check did not pass, so it waits." });
      Object.assign(r, { lane: "waits", trainerSees: v.trainerSees, memberSees: member(v.memberSees) });
    } else if (s.level == 3) r.steps = swap(r.steps, "lane_gate", { say: "Level 3. You chose this reply to send on its own. Your last check passed." });
  } else if (k == "chat_review") {
    if (s.level < 2) r.steps = swap(t.steps, "lane_gate", { say: "Level 1: " + lv[1].summary });
    if (s.level == 3) r.why = vr(t, "level").why;
  } else if (k == "topic" && !s.supplementsTopic) {
    const v = vr(t, "supplementsTopic"), ai = t.steps.findIndex((x) => x.sp == "any_ai");
    const st = t.steps.slice();
    st[1] = { ...st[1], result: "clear", say: "Supplements: not one of your topics now." };
    st.splice(ai, 1, { sp: "rule_finder", at: 680, dur: 360, result: "none", say: "Supplement questions never match a reply that sends on its own." },
      { sp: "draft_writer", at: 1100, dur: 1600, result: "wrote", say: "Drafts a reply for you", basis: "illustrative" });
    st[st.length - 1] = { ...st[st.length - 1], at: 2800, say: "A draft, so it waits for you." };
    Object.assign(r, { steps: st, why: v.why, trainerSees: v.trainerSees, memberSees: member(v.memberSees), note: null });
  } else if (k == "plan") {
    const p = planScore(t, s), ad = t.sure.signals.logged !== undefined, v = vr(t, ad ? "thresholdAtMost" : "thresholdAbove");
    r.sure = { display: p.display, score: p.score, bar: p.bar, pct: p.pct };
    r.reasons = p.auto ? null : p.reasons;
    r.lane = p.auto ? "sent" : "waits";
    r.why = s.planMode == "supervised" ? "Supervised mode." : `${p.pct}% ${p.confident ? "meets" : "is below"} your bar of ${p.bar}%.`;
    r.steps = swap(swap(t.steps, "confidence", { say: p.display }), "lane_gate", p.auto
      ? { result: "sent", say: ad ? "Meets your bar, so it is sent on its own." : "Sent on its own. Picked for a spot check." }
      : { result: "waits", say: s.planMode == "supervised" ? `Supervised mode: every ${ad ? "adjustment" : "plan"} goes to you.` : "Below your bar, so it waits for you." });
    if (r.lane != t.lane) Object.assign(r, { trainerSees: v.trainerSees, memberSees: ad ? t.memberSees : null });
    if (!p.auto) r.tag = r.note = null;
  } else if (k == "voice") {
    const kg = t.inputs ? t.inputs.loadKg : 60, n = reducedLoad(kg, s.tooHeavyPct);
    const line = n == null ? "Your trainer's plan keeps this weight. Say pain if something hurts." : `Lighter weight for the next set: ${fmtKg(n)} kilograms.`;
    r.steps = swap(t.steps, "set_logger", {
      say: n == null ? `"Too heavy" → your rule is off → keeps ${kg} kg` : `"Too heavy" → your ${s.tooHeavyPct}% rule → ${fmtKg(n)} kg`,
      script: t.steps.find((x) => x.sp == "set_logger").script.map((x) => (/^(Lighter|Your trainer's plan)/.test(x.text) ? { ...x, text: line } : x)),
    });
    r.memberSees = { verbatim: true, parts: [{ by: "code", text: line }] };
    r.why = n == null ? "Your too-heavy rule is off." : `${s.tooHeavyPct}% off ${kg} kg is ${fmtKg(n)} kg.`;
  } else if (k == "recovery") {
    const v = s.recoveryReading, band = v < 34 ? "low" : v < 67 ? "moderate" : "high", w = t.inputs.workout;
    const rule = !s.recoveryRule || band == "high" ? null : band == "low" ? [s.lowLoadPct, s.lowVolumePct] : [0, d.settingsDefault.recovery.moderate.volumePct];
    const out = rule ? reduceWorkout(w, rule[0], rule[1]) : w, lines = [];
    out.forEach((e, i) => {
      const o = w[i];
      if (o.reps != null && (e.reps != o.reps || e.loadKg != o.loadKg))
        lines.push(e.loadKg == o.loadKg ? `${o.name} ${o.sets} × ${o.reps} → ${e.sets} × ${e.reps}, load unchanged`
          : `${o.name} ${o.sets} × ${o.reps} at ${o.loadKg} kg → ${e.sets} × ${e.reps} at ${e.loadKg} kg`);
      if (o.alt && e.alt && e.alt.loadKg != o.alt.loadKg) lines.push(`${o.alt.name} ${o.alt.loadKg} → ${e.alt.loadKg} kg`);
      if (o.durationSeconds != null && e.durationSeconds != o.durationSeconds) lines.push(`${o.name} ${o.durationSeconds} s → ${e.durationSeconds} s`);
      if (o.distanceMeters != null && e.distanceMeters != o.distanceMeters) lines.push(`${o.name} ${o.distanceMeters} m → ${e.distanceMeters} m`);
    });
    const label = band == "low" ? "low (below 34)" : band == "moderate" ? "moderate (34–66)" : "high (67 or more)";
    r.steps = [
      { ...t.steps[0], say: `Recovery ${v}%: ${label}. Fresh, scored reading.` },
      { ...t.steps[1], result: lines.length ? "applied" : "clear",
        say: !s.recoveryRule ? "Your recovery rule is off." : !rule ? "No change for this band." : `Your rule for ${band} recovery: load −${rule[0]}%, volume −${rule[1]}%.`,
        detail: lines.length ? [...lines, "Sets, rests, warm-up and cool-down unchanged"] : ["The workout runs as planned"] },
      t.steps[2]];
    const sq = out[0], o = w[0];
    r.memberSees = lines.length ? { verbatim: false, parts: [{ by: "code", text: `Adjusted for your recovery: ${o.name} ${sq.sets} × ${sq.reps} at ${sq.loadKg} kg (was ${o.sets} × ${o.reps} at ${o.loadKg} kg)` }] }
      : { verbatim: false, parts: [{ by: "code", text: "Today's workout runs as planned." }] };
    r.why = !s.recoveryRule ? "Your recovery rule is off. The workout runs as planned."
      : band == "high" ? `${v}% is not low or moderate. The workout runs as planned.`
      : band == "moderate" ? `${v}% is moderate. Your moderate rule: volume −${rule[1]}%.` : null;
  }
  return r;
}
/** "In this sample: …" from the lanes of every playable trace. */
export function totals(d, s) {
  const n = { sent: 0, member: 0, waits: 0, paused: 0, learn: 0 };
  for (const t of d.traces) if (!isOff(t, s)) n[decide(t, s, d).lane]++;
  const p = (x, w) => `${x} ${w}${x == 1 ? "" : "s"}`;
  return `In this sample: ${n.sent} within your rules · ${p(n.member, "member check")} · ${n.waits} waited · ${n.paused} paused · ${p(n.learn, "new rule")}`;
}

