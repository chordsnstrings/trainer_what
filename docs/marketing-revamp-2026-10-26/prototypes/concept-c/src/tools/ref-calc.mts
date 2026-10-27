// Reference results from the real calculator logic in the repo, for qa.cjs.
//   node src/tools/ref-calc.mts   (Node 24, type stripping) -> src/tools/ref-calc.json
import * as m from "/home/user/trainer_what/packages/domain/src/marketing-calculators.ts";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const D = m.DEFAULT_EARNINGS_INPUTS as any, F = m.DEFAULT_FOLLOWER_INPUTS as any;
const pick = (e: any) => ({ averageMonthlyMinor: e.averageMonthlyMinor, subscriptionMonthlyMinor: e.subscriptionMonthlyMinor, commissionMinor: e.commissionMinor, beforeOtherCostsMinor: e.beforeOtherCostsMinor, equivalentSessions: e.equivalentSessions, effectiveCommissionPct: e.effectiveCommissionPct });
const f = m.estimateFollowerConversion(F);
const f20 = m.estimateFollowerConversion({ ...F, followers: 20000 });
const out = {
  followerInputs: F, earningsInputs: D,
  follower: Object.fromEntries(Object.entries(f.scenarios).map(([k, s]: any) => [k, { revenueMonth12Minor: s.revenueMonth12Minor, activeMonth12: s.activeMonth12, signups12: s.signups12, month1New: s.month1New }])),
  full: pick(m.estimateEarnings(D)),
  compact: pick(m.estimateEarnings({ ...D, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0 })),
  worked: pick(m.estimateEarnings({ subscribers: 150, billing: "monthly", workoutPriceAed: 199, programmeMonths: 1, nutritionSharePct: 0, nutritionPriceAed: 0, voiceSharePct: 0, voicePriceAed: 0, sessionsPerMonth: 0, sessionPriceAed: 0, yourSessionRateAed: 250 })),
  follower20k: Object.fromEntries(Object.entries(f20.scenarios).map(([k, s]: any) => [k, s.revenueMonth12Minor])),
  full150: pick(m.estimateEarnings({ ...D, subscribers: 150 })),
};
writeFileSync(fileURLToPath(new URL("./ref-calc.json", import.meta.url)), JSON.stringify(out, null, 1));
console.log("follower month-12 AED:", Object.values(out.follower).map((s: any) => s.revenueMonth12Minor / 100).join(" / "), "· earnings kept AED:", out.full.beforeOtherCostsMinor / 100);
