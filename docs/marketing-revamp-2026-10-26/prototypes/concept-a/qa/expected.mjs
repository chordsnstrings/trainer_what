// Expected calculator figures computed with the REAL domain module (packages/domain/src/marketing-calculators.ts).
import { writeFileSync } from "node:fs";
const m = await import("/home/user/trainer_what/packages/domain/src/marketing-calculators.ts");
const nf = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 });
const aed = (minor) => "AED " + nf.format(Math.round(minor / 100));
const count = (n) => (m.displayCount(n) === null ? "fewer than 1" : nf.format(m.displayCount(n)));
const fol = (inp) => { const e = m.estimateFollowerConversion({ ...m.DEFAULT_FOLLOWER_INPUTS, ...inp }); const o = {}; for (const k of ["cautious", "typical", "strong"]) { const s = e.scenarios[k]; o[k] = { revenue: aed(s.revenueMonth12Minor), month1New: count(s.month1New), active12: count(s.activeMonth12), signups12: count(s.signups12) }; } return o; };
const earn = (inp) => { const e = m.estimateEarnings({ ...m.DEFAULT_EARNINGS_INPUTS, ...inp }); return { keep: aed(e.beforeOtherCostsMinor), subs: aed(e.subscriptionMonthlyMinor), commission: aed(e.commissionMinor), avg: aed(e.averageMonthlyMinor), eff: e.effectiveCommissionPct, sessions: e.equivalentSessions }; };
const compact = (n, p, r) => earn({ subscribers: n, workoutPriceAed: p, yourSessionRateAed: r, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0 });
const out = {
  followerDefault: fol({}),
  follower20000: fol({ followers: 20000 }),
  earningsDefault: earn({}),
  earnings250: earn({ subscribers: 250 }),
  compact60: compact(60, 199, 250),
  compact150: compact(150, 199, 250),
  compact300: compact(300, 199, 250),
};
writeFileSync(new URL("./expected.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
