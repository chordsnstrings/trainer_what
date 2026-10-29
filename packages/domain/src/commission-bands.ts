// The commission bands and the commission on one charge. A module of its
// own, with no imports, so the marketing calculators that run in the browser
// (marketing-calculators.ts) take only this, not the whole domain index.
export const BANDS = [
  { count: 100, bps: 2500 },
  { count: 200, bps: 2000 },
  { count: 700, bps: 1500 },
  { count: Infinity, bps: 1000 },
];
export function commission(amountMinor: number, rank: number) {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !Number.isSafeInteger(rank) ||
    rank < 1
  )
    throw new Error("Invalid commission inputs");
  const bps =
    rank <= 100 ? 2500 : rank <= 300 ? 2000 : rank <= 1000 ? 1500 : 1000;
  return Number((BigInt(amountMinor) * BigInt(bps) + 5000n) / 10000n);
}
