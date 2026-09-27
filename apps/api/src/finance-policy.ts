import type { Actor, Tx } from "@trainer/db";
import { event, putRecord } from "@trainer/db";
import { z } from "zod";
export const financePolicySchema = z
  .object({
    effectiveAt: z.string().datetime(),
    commissionBps: z.tuple([
      z.number().int().min(0).max(10000),
      z.number().int().min(0).max(10000),
      z.number().int().min(0).max(10000),
      z.number().int().min(0).max(10000),
    ]),
    bookingFeeBps: z.number().int().min(0).max(10000).default(0),
    graceDays: z.number().int().min(0).max(14).default(3),
    reason: z.string().trim().min(10).max(1000),
    revision: z.string().uuid().nullable(),
  })
  .strict();
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
export async function effectiveFinancePolicy(tx: Tx, at = new Date()) {
  const [r] = await tx.query(
    "SELECT id,data FROM records WHERE kind='finance_policy' AND status='published' AND (data->>'effectiveAt')::timestamptz<=$1 ORDER BY (data->>'effectiveAt')::timestamptz DESC,created_at DESC LIMIT 1",
    [at.toISOString()],
  );
  return (
    r ?? {
      id: "marginal-stable-rank-v1",
      data: {
        commissionBps: [2500, 2000, 1500, 1000],
        bookingFeeBps: 0,
        graceDays: 3,
      },
    }
  );
}
export function feeInMinor(amount: number, bps: number) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isInteger(bps) ||
    bps < 0 ||
    bps > 10000
  )
    throw new Error("Invalid fee input");
  return Number((BigInt(amount) * BigInt(bps) + 5000n) / 10000n);
}
export async function publishFinancePolicy(
  tx: Tx,
  a: Actor,
  raw: unknown,
  now = new Date(),
) {
  const input = financePolicySchema.parse(raw);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [latest] = await tx.query(
    "SELECT * FROM records WHERE kind='finance_policy' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  if ((latest?.id ?? null) !== input.revision)
    throw fail(
      "STALE_REVISION",
      "Fee policy changed; reload before publishing",
    );
  if (new Date(input.effectiveAt).getTime() < now.getTime())
    throw fail(
      "RETROACTIVE_POLICY",
      "Fee policies apply prospectively; historical journals retain their original policy",
    );
  const [sameDate] = await tx.query(
    "SELECT id FROM records WHERE kind='finance_policy' AND data->>'effectiveAt'=$1",
    [input.effectiveAt],
  );
  if (sameDate)
    throw fail(
      "EFFECTIVE_DATE_CONFLICT",
      "Choose a distinct effective time for this policy revision",
    );
  const r = await putRecord(
    tx,
    a,
    "finance_policy",
    { ...input, previousPolicyId: latest?.id ?? null, publishedBy: a.userId },
    { status: "published" },
  );
  await event(tx, a, "finance.policy_published", r.id, {
    reason: input.reason,
    effectiveAt: input.effectiveAt,
  });
  return r;
}
