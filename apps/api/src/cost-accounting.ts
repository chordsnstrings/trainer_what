import { randomUUID } from "node:crypto";
import type { Actor, Database, Tx } from "@trainer/db";
import { event } from "@trainer/db";
import type { ModelPrice } from "../../../packages/providers/src/model-accounting.ts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { memberAccess } from "./entitlements.ts";

// Cost accounting shared by every provider cost writer and the finance
// screens (docs/features/platform-finance.md, phase A): what a cost row was
// for (member, product, complimentary access), the monthly USD to AED rate,
// the usage-charge rules and the explicit estimation of unresolved rows.

/** Voice provider tasks (speech, transcription, previews and clones). */
export const VOICE_TASK_SQL = "task LIKE 'voice.%'";
export const isVoiceTask = (task: string) => task.startsWith("voice.");

export type CostProduct =
  | "membership"
  | "programme"
  | "nutrition"
  | "voice_addon"
  | "trainer_setup";
/**
 * The product a cost serves: what the member bought (membership, upfront
 * programme, the nutrition tier, the voice add-on), or the trainer's own
 * set-up work (teaching, compiling and qualifying their Brain, voice clones).
 */
export function costProduct(task: string, billing?: string | null): CostProduct {
  if (task === "voice.clone" || task === "voice.preview") return "trainer_setup";
  if (isVoiceTask(task)) return "voice_addon";
  if (task === "nutrition_week" || task === "meal_photo_estimate")
    return "nutrition";
  if (["brain_plan", "brain_plan_adaptation", "coaching"].includes(task))
    return billing === "upfront" ? "programme" : "membership";
  return "trainer_setup";
}
export type CostTags = {
  memberId: string | null;
  product: CostProduct;
  complimentary: boolean;
};
/**
 * Tags for one cost row, read in the caller's own tenant scope (row security
 * never raises: a scope that cannot see the member's rows tags it as paid).
 * Complimentary means the member's only current access is a trainer's grant.
 */
export async function costTags(
  tx: Tx,
  memberId: string | null | undefined,
  task: string,
): Promise<CostTags> {
  if (!memberId)
    return { memberId: null, product: costProduct(task), complimentary: false };
  const access = await memberAccess(tx, memberId);
  return {
    memberId,
    product: costProduct(task, access.subscription?.data?.billing ?? null),
    complimentary: !access.subscription && !!access.grant,
  };
}

/**
 * Reserves one voice provider call (speech, transcription, preview or clone)
 * at its estimate from the provider's price settings, tagged like model
 * calls. `status: 'estimated'` records a call that already answered (a
 * supplement for extra provider-timed audio).
 */
export async function reserveVoiceCost(
  tx: Tx,
  row: {
    id: string;
    tenantId: string;
    userId: string | null;
    memberId: string | null;
    task: string;
    provider: string;
    model: string | null;
    priceVersion: string | null;
    pricing: Record<string, unknown> & { reservedCostUsd: number };
    traceId: string | null;
    status?: "reserved" | "estimated";
  },
) {
  const tags = await costTags(tx, row.memberId, row.task);
  const estimated = row.status === "estimated";
  await tx.query(
    "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,status,price_version,pricing,trace_id,estimated_cost_usd,cost_usd,member_id,product,complimentary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,round($11::numeric,8),CASE WHEN $7='estimated' THEN round($11::numeric,8) END,$12,$13,$14)",
    [
      row.id,
      row.tenantId,
      row.userId,
      row.task,
      row.provider,
      row.model,
      estimated ? "estimated" : "reserved",
      row.priceVersion,
      JSON.stringify({ ...row.pricing, estimated: true }),
      row.traceId,
      String(Math.max(0, row.pricing.reservedCostUsd || 0)),
      tags.memberId,
      tags.product,
      tags.complimentary,
    ],
  );
}
/**
 * A provider call that answered is priced now at the estimate it was reserved
 * at, and marked 'estimated' so it never blocks the monthly usage charge,
 * month close or payouts. The provider's invoice can still correct it
 * ('reconciled'). A call whose outcome is unknown stays unknown.
 */
export async function costEstimated(
  tx: Tx,
  usageId: string | null | undefined,
  evidence: Record<string, unknown> = {},
) {
  if (!usageId) return;
  await tx.query(
    "UPDATE cost_events SET status='estimated',cost_usd=estimated_cost_usd,pricing=pricing||$2::jsonb WHERE id=$1 AND status IN ('reserved','unknown') AND estimated_cost_usd IS NOT NULL",
    [usageId, JSON.stringify({ pricedAtCall: true, ...evidence })],
  );
}

/**
 * A voice call that failed before it was sent costs nothing: the step that
 * marks a row 'unknown' runs immediately before the provider request, so a
 * row still 'reserved' when the call fails was never sent. It is released at
 * zero ('recorded', like voice clones), never estimated or charged. A row
 * already 'unknown' (sent, outcome unconfirmed) is left for the invoice.
 */
export async function costNotSent(tx: Tx, usageId: string | null | undefined) {
  if (!usageId) return;
  await tx.query(
    "UPDATE cost_events SET status='recorded',cost_usd=0,pricing=pricing||$2::jsonb WHERE id=$1 AND status='reserved'",
    [usageId, JSON.stringify({ released: "not_sent" })],
  );
}

/** The reviewed token price in effect for a provider and model, if any. */
export async function reviewedModelPrice(
  db: Database,
  provider: string,
  model: string,
  at = new Date(),
): Promise<ModelPrice | null> {
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT input_usd_per_million::text AS input,output_usd_per_million::text AS output,price_version FROM model_prices WHERE provider=$1 AND model=$2 AND effective_from<=$3 ORDER BY effective_from DESC LIMIT 1",
      [provider, model, at.toISOString()],
    ),
  );
  return row
    ? {
        inputUsdPerMillion: Number(row.input),
        outputUsdPerMillion: Number(row.output),
        priceVersion: row.price_version,
      }
    : null;
}

// ---- Settings (Settings → Platform finance) ---------------------------------

export type FinanceSettings = {
  defaultAedPerUsd: number;
  markupPercent: number;
  complimentaryBearer: "trainer" | "platform";
  estimateUnresolved: boolean;
};
/**
 * Owner decisions still pending keep today's behaviour by default: trainers
 * pay usage at cost (0% markup), including their complimentary members', and
 * automatic month close waits for unresolved provider calls to be priced
 * (automatic estimation is off unless turned on).
 */
export function financeSettings(config = runtimeConfig()): FinanceSettings {
  const rate = Number(config.FINANCE_USD_TO_AED);
  const markup = Number(config.FINANCE_USAGE_MARKUP_PERCENT);
  return {
    defaultAedPerUsd: rate >= 1 && rate <= 10 ? rate : 3.6725,
    markupPercent: markup >= 0 && markup <= 100 ? markup : 0,
    complimentaryBearer:
      config.FINANCE_COMPLIMENTARY_USAGE_BEARER === "platform"
        ? "platform"
        : "trainer",
    estimateUnresolved: config.FINANCE_ESTIMATE_UNRESOLVED_USAGE === "true",
  };
}

// ---- Monthly exchange rates ---------------------------------------------------

export type MonthRate = {
  month: string;
  aedPerUsd: number;
  /** "reviewed": a Super admin recorded it; "default": the settings' rate. */
  source: "reviewed" | "default";
  revision: number | null;
  note: string | null;
  reviewedAt: string | null;
};
export const periodSchemaText = /^\d{4}-(0[1-9]|1[0-2])$/;
/**
 * A Dubai calendar month as a half-open UTC range [from, to). Dubai keeps
 * UTC+4 all year, so the range selects exactly the rows whose Dubai month is
 * `period`, and a created_at range can use the (tenant, created_at) indexes.
 */
export function dubaiMonthRange(period: string) {
  if (!periodSchemaText.test(period)) throw new Error("Invalid month");
  const [year, month] = period.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, 1) - 4 * 3600000),
    to: new Date(Date.UTC(year, month, 1) - 4 * 3600000),
  };
}
/** Each month's current rate: its latest reviewed revision, else the default. */
export async function monthRates(
  db: Database,
  months: string[],
  settings = financeSettings(),
): Promise<Map<string, MonthRate>> {
  const rows = months.length
    ? await db.system((tx) =>
        tx.query(
          "SELECT DISTINCT ON (month) month,revision,aed_per_usd::text AS rate,source,created_at FROM exchange_rates WHERE month=ANY($1::text[]) ORDER BY month,revision DESC",
          [months],
        ),
      )
    : [];
  const reviewed = new Map(rows.map((r) => [r.month, r]));
  return new Map(
    months.map((month) => {
      const r = reviewed.get(month);
      return [
        month,
        r
          ? {
              month,
              aedPerUsd: Number(r.rate),
              source: "reviewed" as const,
              revision: r.revision,
              note: r.source,
              reviewedAt: new Date(r.created_at).toISOString(),
            }
          : {
              month,
              aedPerUsd: settings.defaultAedPerUsd,
              source: "default" as const,
              revision: null,
              note: null,
              reviewedAt: null,
            },
      ];
    }),
  );
}
export async function monthRate(db: Database, month: string) {
  return (await monthRates(db, [month])).get(month)!;
}

// ---- Usage charged to trainers ----------------------------------------------

export type PeriodUsage = {
  /** Every cost row of the month (the close check compares this count). */
  events: number;
  unpriced: number;
  estimated: number;
  /** USD the trainer is charged for (all priced rows, less excluded ones). */
  chargeableUsd: string;
  /** Complimentary members' cost the platform bears (when it is set to). */
  platformBorneUsd: string;
  markupPercent: number;
  complimentaryBearer: FinanceSettings["complimentaryBearer"];
  aedPerUsd: number;
  chargeMinor: number;
};
/**
 * One month's usage charge for the scoped workspace: priced cost (recorded,
 * reconciled or estimated) converted at `aedPerUsd` with the markup, rounded
 * once to AED minor units. Unpriced rows are counted; the caller refuses to
 * charge while any remain.
 */
export async function periodUsage(
  tx: Tx,
  period: string,
  aedPerUsd: number,
  settings = financeSettings(),
): Promise<PeriodUsage> {
  const platform = settings.complimentaryBearer === "platform";
  const range = dubaiMonthRange(period);
  const [usage] = await tx.query(
    "SELECT count(*)::int AS n,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unpriced,count(*) FILTER(WHERE status='estimated')::int AS estimated,coalesce(sum(cost_usd) FILTER(WHERE NOT ($3 AND complimentary)),0)::numeric(18,8)::text AS usd,coalesce(sum(cost_usd) FILTER(WHERE $3 AND complimentary),0)::numeric(18,8)::text AS borne,round(coalesce(sum(cost_usd) FILTER(WHERE NOT ($3 AND complimentary)),0)*$2::numeric*(100+$4::numeric))::text AS minor FROM cost_events WHERE created_at>=$1::timestamptz AND created_at<$5::timestamptz",
    [
      range.from.toISOString(),
      aedPerUsd,
      platform,
      settings.markupPercent,
      range.to.toISOString(),
    ],
  );
  return {
    events: usage.n,
    unpriced: usage.unpriced,
    estimated: usage.estimated,
    chargeableUsd: usage.usd,
    platformBorneUsd: usage.borne,
    markupPercent: settings.markupPercent,
    complimentaryBearer: settings.complimentaryBearer,
    aedPerUsd,
    chargeMinor: Number(usage.minor),
  };
}

// ---- Explicit estimates for unresolved rows ------------------------------------

/**
 * Prices the scoped workspace's unresolved cost rows (unknown, or reserved
 * for more than fifteen minutes, longer than any provider call may run) at
 * their estimate and marks them 'estimated': the reserved estimate a voice
 * call stored, or for a model call whose answer was lost the average priced
 * cost of the same task and model within 90 days. Rows with no possible estimate stay unresolved and are counted.
 * `before` limits the rows by time (a month's cutoff). A provider invoice can
 * still correct every estimated row later.
 */
export async function estimateUnresolvedUsage(
  tx: Tx,
  a: Actor,
  input: {
    before?: Date;
    evidenceReference: string;
    method: "operator" | "automation";
  },
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  // The 90-day average is computed only for rows with no stored estimate
  // (a model call whose answer was lost); CASE evaluates it lazily.
  const rows = await tx.query(
    "SELECT c.id,c.task,c.model,c.status,c.estimated_cost_usd::text AS estimate,CASE WHEN c.estimated_cost_usd IS NULL THEN (SELECT avg(p.cost_usd) FROM cost_events p WHERE p.task=c.task AND p.model IS NOT DISTINCT FROM c.model AND p.cost_usd IS NOT NULL AND p.created_at>c.created_at-interval '90 days' AND p.created_at<=c.created_at+interval '90 days')::text END AS average FROM cost_events c WHERE c.cost_usd IS NULL AND (c.status='unknown' OR (c.status='reserved' AND c.created_at<now()-interval '15 minutes')) AND ($1::timestamptz IS NULL OR c.created_at<$1) ORDER BY c.created_at LIMIT 5000",
    [input.before?.toISOString() ?? null],
  );
  const remaining: Array<{ id: string; task: string; model: string | null }> = [];
  const priced: Array<{ id: string; value: string; basis: string; previous: string }> = [];
  for (const row of rows) {
    if (row.estimate !== null)
      priced.push({ id: row.id, value: row.estimate, basis: "stored_estimate", previous: row.status });
    else if (row.average !== null)
      priced.push({ id: row.id, value: row.average, basis: "average_same_task_model", previous: row.status });
    else remaining.push({ id: row.id, task: row.task, model: row.model });
  }
  // One set-based update for every row with a basis.
  const updated = priced.length
    ? await tx.query(
        "UPDATE cost_events c SET estimated_cost_usd=coalesce(c.estimated_cost_usd,round(v.value,8)),cost_usd=coalesce(c.estimated_cost_usd,round(v.value,8)),status='estimated',reconciliation=$5::jsonb||jsonb_build_object('basis',v.basis,'previousStatus',v.previous) FROM unnest($1::uuid[],$2::numeric[],$3::text[],$4::text[]) AS v(id,value,basis,previous) WHERE c.id=v.id AND c.cost_usd IS NULL AND c.status IN ('unknown','reserved') RETURNING c.cost_usd::text AS cost",
        [
          priced.map((r) => r.id),
          priced.map((r) => r.value),
          priced.map((r) => r.basis),
          priced.map((r) => r.previous),
          JSON.stringify({
            method: input.method === "automation" ? "automatic_estimate" : "operator_estimate",
            evidenceReference: input.evidenceReference,
            estimatedBy: a.userId,
            estimatedAt: new Date().toISOString(),
          }),
        ],
      )
    : [];
  const estimated = updated.length;
  const estimatedUsd = updated.reduce((n, r) => n + Number(r.cost), 0);
  if (estimated)
    await event(tx, a, "finance.usage_estimated", randomUUID(), {
      rows: estimated,
      estimatedUsd: Math.round(estimatedUsd * 1e8) / 1e8,
      method: input.method,
      evidenceReference: input.evidenceReference,
      remaining: remaining.length,
    });
  return {
    estimated,
    estimatedUsd: Math.round(estimatedUsd * 1e8) / 1e8,
    remaining: remaining.length,
    remainingRows: remaining.slice(0, 20),
  };
}
