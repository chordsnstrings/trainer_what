import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { elevated, type Actor, type Database, type Tx } from "@trainer/db";
import { platformWorkspaceSql } from "./workspace-state.ts";
import { journal } from "./finance.ts";
import { notifyUser } from "./notifications.ts";
import { monthCutoff, reconcileModelUsage } from "./finance-operations.ts";
import {
  AI_COACH_SERVICE_FEE,
  dubaiMonthRange,
  financeSettings,
  periodSchemaText,
  periodUsage,
} from "./cost-accounting.ts";
import { priceProviderUsage, providerUsage, usdText, usdUnits } from "./platform-finance.ts";
import { recordInvoiceCost } from "./platform-costs.ts";

// Provider invoices (docs/features/platform-finance.md, phase C): a CSV or
// JSON invoice export is imported once per provider and reference. Lines
// naming a provider request reconcile that call; the rest of the usage total
// prices the month's estimated and unresolved calls in proportion to their
// estimates (as "Price a provider's month"); plan fees and any remainder not
// attributed to calls become platform costs. Months whose usage was already
// charged keep their posted statement: the difference is a new
// "usage-adjustment:" journal in the trainer's ledger (the AI Coach Service
// Fee adjustment), at the markup and rate that statement used.

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const MAX_LINES = 10000;
/** A provider export has a handful of columns; a wide header is refused. */
const MAX_COLUMNS = 50;
const USD = /^\d{1,9}(\.\d{1,8})?$/;
/** The CSV columns read (header names, lower case with underscores). */
const CSV_COLUMNS = [
  "cost_usd",
  "amount_usd",
  "amount",
  "kind",
  "type",
  "request_id",
  "provider_request_id",
  "description",
];
/**
 * The key of an invoice reference in the trainer's ledger: an adjustment's
 * source key and notification carry this hash, never the operator's
 * reference (which may name the AI provider); the reference itself stays in
 * the journal's data, which trainers never see.
 */
export const referenceKey = (reference: string) =>
  createHash("sha256").update(reference).digest("hex").slice(0, 16);

export type InvoiceLine = {
  kind: "usage" | "plan";
  requestId: string | null;
  costUsd: string;
  description: string | null;
};

/** Splits one CSV record (RFC 4180 quoting). */
function csvRecords(content: string) {
  const records: string[][] = [];
  let field = "",
    record: string[] = [],
    quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted) {
      if (c === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      record.push(field);
      if (record.some((x) => x.trim() !== "")) records.push(record);
      record = [];
      field = "";
    } else field += c;
    if (records.length > MAX_LINES + 1)
      throw fail(400, "INVOICE_TOO_LARGE", `An invoice may have at most ${MAX_LINES} lines`);
  }
  record.push(field);
  if (record.some((x) => x.trim() !== "")) records.push(record);
  if (quoted) throw fail(400, "INVOICE_UNREADABLE", "An unterminated quote in the CSV");
  return records;
}
const line = (raw: Record<string, unknown>, at: number): InvoiceLine => {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") return raw[k];
    return undefined;
  };
  const cost = String(pick("cost_usd", "costUsd", "amount_usd", "amountUsd", "amount") ?? "").trim();
  if (!USD.test(cost))
    throw fail(400, "INVOICE_UNREADABLE", `Line ${at}: the amount must be US dollars such as 12.50 (up to eight decimals)`);
  const kind = String(pick("kind", "type") ?? "usage").trim().toLowerCase();
  if (!["usage", "plan"].includes(kind))
    throw fail(400, "INVOICE_UNREADABLE", `Line ${at}: kind must be usage or plan`);
  const request = pick("request_id", "requestId", "provider_request_id", "providerRequestId");
  const requestId = request === undefined ? null : String(request).trim().slice(0, 200) || null;
  const description = pick("description");
  return {
    kind: kind as InvoiceLine["kind"],
    requestId,
    costUsd: cost,
    description: description === undefined ? null : String(description).slice(0, 200),
  };
};
/**
 * Reads an invoice export. CSV: a header with `cost_usd` (or `amount_usd`,
 * `amount`) and optional `request_id`, `kind` (usage or plan) and
 * `description`. JSON: `{ "lines": [...] }` or an array of the same fields,
 * with an optional `totalUsd` that must equal the lines.
 */
export function parseInvoice(format: "csv" | "json", content: string) {
  let lines: InvoiceLine[];
  if (format === "csv") {
    const [header, ...rows] = csvRecords(content);
    if (!header) throw fail(400, "INVOICE_UNREADABLE", "The CSV is empty");
    if (header.length > MAX_COLUMNS)
      throw fail(400, "INVOICE_UNREADABLE", `The CSV may have at most ${MAX_COLUMNS} columns`);
    const names = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    if (!names.some((n) => ["cost_usd", "amount_usd", "amount"].includes(n)))
      throw fail(400, "INVOICE_UNREADABLE", "The CSV needs a cost_usd column");
    // Each column read is found once; a row is read by position.
    const columns = CSV_COLUMNS.flatMap((name) => {
      const at = names.indexOf(name);
      return at < 0 ? [] : [[name, at] as const];
    });
    lines = rows.map((r, i) => {
      if (r.length > names.length && r.slice(names.length).some((x) => x.trim() !== ""))
        throw fail(400, "INVOICE_UNREADABLE", `Line ${i + 2} has more fields than the header`);
      return line(Object.fromEntries(columns.map(([name, at]) => [name, r[at]])), i + 2);
    });
  } else {
    let data: any;
    try {
      data = JSON.parse(content);
    } catch {
      throw fail(400, "INVOICE_UNREADABLE", "The JSON could not be read");
    }
    const list = Array.isArray(data) ? data : data?.lines;
    if (!Array.isArray(list))
      throw fail(400, "INVOICE_UNREADABLE", 'The JSON needs a "lines" array');
    if (list.length > MAX_LINES)
      throw fail(400, "INVOICE_TOO_LARGE", `An invoice may have at most ${MAX_LINES} lines`);
    lines = list.map((x: any, i: number) => {
      if (!x || typeof x !== "object" || Array.isArray(x))
        throw fail(400, "INVOICE_UNREADABLE", `Line ${i + 1} is not an object`);
      return line(x, i + 1);
    });
    if (!Array.isArray(data) && data.totalUsd !== undefined) {
      const total = lines.reduce((n, l) => n + usdUnits(l.costUsd), 0n);
      if (!USD.test(String(data.totalUsd)) || usdUnits(String(data.totalUsd)) !== total)
        throw fail(400, "INVOICE_TOTAL_MISMATCH", "totalUsd does not equal the lines");
    }
  }
  if (!lines.length) throw fail(400, "INVOICE_UNREADABLE", "The invoice has no lines");
  const sum = (kind: InvoiceLine["kind"]) =>
    lines.filter((l) => l.kind === kind).reduce((n, l) => n + usdUnits(l.costUsd), 0n);
  return {
    lines,
    usageUnits: sum("usage"),
    planUnits: sum("plan"),
  };
}

export const invoiceInput = z
  .object({
    provider: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{0,59}$/),
    month: z.string().regex(periodSchemaText),
    reference: z.string().trim().min(3).max(200),
    format: z.enum(["csv", "json"]),
    content: z.string().min(1).max(1000000),
    evidenceReference: z.string().trim().min(10).max(500),
    acknowledgeFactor: z.boolean().optional(),
  })
  .strict();

async function trainerWorkspaces(db: Database) {
  return db.system((tx) =>
    tx.query<{ id: string; name: string }>(
      "SELECT t.id,t.name FROM tenants t WHERE NOT " + platformWorkspaceSql("t.id") + " ORDER BY t.id",
    ),
  );
}
const operator = (a: Actor, tenantId: string) =>
  elevated("platform-operator", { tenantId, userId: a.userId, role: "finance" });

/**
 * Imports a provider invoice (see the header). Idempotent: the same provider
 * and reference with the same content returns the recorded import; other
 * content under that reference is refused.
 */
export async function importProviderInvoice(
  db: Database,
  a: Actor,
  raw: unknown,
  now = new Date(),
) {
  const b = invoiceInput.parse(raw);
  const hash = createHash("sha256").update(b.content).digest("hex");
  const [existing] = await db.system((tx) =>
    tx.query("SELECT * FROM provider_invoices WHERE provider=$1 AND reference=$2", [b.provider, b.reference]),
  );
  if (existing) {
    if (existing.result?.contentHash !== hash || existing.month !== b.month)
      throw fail(409, "INVOICE_CONFLICT", "This provider reference was imported with other content");
    return { ...existing.result, invoiceId: existing.id, alreadyImported: true };
  }
  if (monthCutoff(b.month).getTime() > now.getTime())
    throw fail(409, "PERIOD_OPEN", "Import a provider's invoice after its month ends");
  const parsed = parseInvoice(b.format, b.content);
  const evidence = `Invoice ${b.reference}: ${b.evidenceReference}`.slice(0, 500);
  const range = dubaiMonthRange(b.month);
  // 1. Lines that name a provider request reconcile that call.
  const byRequest = new Map<string, InvoiceLine>();
  for (const l of parsed.lines)
    if (l.kind === "usage" && l.requestId) byRequest.set(l.requestId, l);
  const matched = new Set<string>();
  const conflicts: string[] = [];
  if (byRequest.size)
    for (const w of await trainerWorkspaces(db)) {
      const rows = await db.tenant(operator(a, w.id), (tx) =>
        tx.query(
          "SELECT id,trace_id FROM cost_events WHERE provider=$1 AND trace_id=ANY($2::text[]) AND created_at>=$3 AND created_at<$4",
          [b.provider, [...byRequest.keys()], range.from.toISOString(), range.to.toISOString()],
        ),
      );
      for (const r of rows) {
        const l = byRequest.get(r.trace_id)!;
        try {
          await db.tenant(operator(a, w.id), (tx) =>
            reconcileModelUsage(tx, operator(a, w.id), r.id, {
              costUsd: l.costUsd,
              providerRequestId: r.trace_id,
              evidenceReference: evidence,
            }),
          );
          matched.add(r.trace_id);
        } catch (e) {
          conflicts.push(`${r.trace_id}: ${(e as Error).message}`.slice(0, 200));
        }
      }
    }
  // 2. The usage total prices the month's remaining estimated and unresolved
  //    calls; with none left, what is not attributed to calls is a platform cost.
  const usageTotal = usdText(parsed.usageUnits);
  const preview = await providerUsage(db, a, {
    period: b.month,
    provider: b.provider,
    invoiceReference: b.reference,
  });
  if (preview.withoutEstimate || preview.inFlight)
    throw fail(
      409,
      preview.inFlight ? "USAGE_IN_FLIGHT" : "ROWS_WITHOUT_ESTIMATE",
      preview.inFlight
        ? "Some calls of this month are still running; try again in a few minutes"
        : `${preview.withoutEstimate} call(s) of this provider and month have no estimate: add their request ids to the invoice lines, or reconcile them one by one, then import again`,
    );
  let priced: Record<string, unknown> | null = null;
  let remainderUsd = 0;
  if (preview.adjustableRows > 0) {
    priced = await priceProviderUsage(
      db,
      a,
      {
        period: b.month,
        provider: b.provider,
        usageTotalUsd: usageTotal,
        invoiceReference: b.reference,
        evidenceReference: evidence,
        expectedRows: preview.adjustableRows,
        expectedEstimateUsd: preview.adjustableEstimateUsd,
        acknowledgeFactor: b.acknowledgeFactor,
      },
      now,
    );
  } else {
    const remainder = parsed.usageUnits - usdUnits(preview.fixedUsd);
    remainderUsd = Number(usdText(remainder));
  }
  const costs: unknown[] = [];
  if (remainderUsd > 0)
    costs.push(
      await recordInvoiceCost(db, {
        provider: b.provider,
        month: b.month,
        reference: b.reference,
        description: `${b.provider} invoice ${b.reference}: charges not attributed to recorded calls`,
        usd: remainderUsd,
        createdBy: a.userId,
        kind: "remainder",
      }),
    );
  const planUsd = Number(usdText(parsed.planUnits));
  if (planUsd > 0)
    costs.push(
      await recordInvoiceCost(db, {
        provider: b.provider,
        month: b.month,
        reference: b.reference,
        description: `${b.provider} plan fee (invoice ${b.reference})`,
        usd: planUsd,
        createdBy: a.userId,
        kind: "plan",
      }),
    );
  // 3. Months already charged: adjustments, never a rewritten statement.
  const corrections = await postUsageCorrections(db, a, b.month, b.reference);
  const result = {
    contentHash: hash,
    lines: parsed.lines.length,
    usageUsd: usageTotal,
    planUsd: usdText(parsed.planUnits),
    reconciledRequests: matched.size,
    unmatchedRequests: [...byRequest.keys()].filter((k) => !matched.has(k)).length,
    conflicts: conflicts.slice(0, 20),
    priced,
    remainderUsd: usdText(usdUnits(String(Math.max(0, remainderUsd)))),
    belowRecordedUsd: remainderUsd < 0 ? usdText(usdUnits(String(-remainderUsd))) : null,
    platformCosts: costs.filter(Boolean).length,
    corrections,
  };
  const [invoice] = await db.system(async (tx) => {
    const rows = await tx.query(
      "INSERT INTO provider_invoices(id,provider,month,reference,format,total_usd,usage_usd,plan_usd,line_count,lines,evidence_reference,result,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(provider,reference) DO NOTHING RETURNING id",
      [
        randomUUID(),
        b.provider,
        b.month,
        b.reference,
        b.format,
        usdText(parsed.usageUnits + parsed.planUnits),
        usageTotal,
        usdText(parsed.planUnits),
        parsed.lines.length,
        JSON.stringify(parsed.lines.slice(0, MAX_LINES)),
        b.evidenceReference,
        JSON.stringify(result),
        a.userId,
      ],
    );
    await tx.query(
      "INSERT INTO admin_operations_audit(id,actor_id,action,data) VALUES($1,$2,$3,$4)",
      [
        randomUUID(),
        a.userId,
        "platform_finance.invoice_imported",
        JSON.stringify({ provider: b.provider, month: b.month, reference: b.reference, ...result, conflicts: conflicts.length }),
      ],
    );
    return rows;
  });
  return { ...result, invoiceId: invoice?.id ?? null, alreadyImported: false };
}

const monthName = (period: string) =>
  new Date(period + "-15T00:00:00Z").toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
/**
 * For every workspace whose usage for `period` was already charged: what
 * its priced usage comes to now, at the statement's own rate, markup and
 * complimentary rule, less what was charged (statement plus earlier
 * adjustments). A difference is posted once per `reference` as an
 * "AI Coach Service Fee adjustment" journal (a charge or a credit) in the
 * current month; the posted statement is never changed. Months still holding
 * unpriced calls are skipped.
 */
export async function postUsageCorrections(
  db: Database,
  a: Actor,
  period: string,
  reference: string,
) {
  const posted: Array<{ tenantId: string; differenceMinor: number }> = [];
  const skipped: Array<{ tenantId: string; reason: string }> = [];
  for (const w of await trainerWorkspaces(db)) {
    const scope = operator(a, w.id);
    const outcome = await db.tenant(scope, async (tx) => {
      const [statement] = await tx.query(
        "SELECT s.*,j.data AS journal_data FROM usage_statements s LEFT JOIN journals j ON j.id=s.journal_id AND j.tenant_id=s.tenant_id WHERE s.period=$1",
        [period],
      );
      if (!statement) return null;
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [w.id]);
      const source = `usage-adjustment:${period}:${referenceKey(reference)}`;
      const [done] = await tx.query("SELECT 1 FROM journals WHERE source_key=$1", [source]);
      if (done) return { skipped: "already_adjusted" };
      const settings = financeSettings();
      const data = statement.journal_data ?? {};
      // The statement's own markup: recorded on its journal; a statement that
      // charged nothing has no journal and follows today's setting; one
      // posted before markups existed was charged at cost.
      const markup =
        data.markupPercent !== undefined && Number.isFinite(Number(data.markupPercent))
          ? Number(data.markupPercent)
          : statement.journal_id
            ? 0
            : settings.markupPercent;
      const usage = await periodUsage(tx, period, Number(statement.fx_aed_per_usd), {
        ...settings,
        markupPercent: markup,
        complimentaryBearer:
          data.complimentaryUsageBearer === "platform" ||
          (!statement.journal_id && settings.complimentaryBearer === "platform")
            ? "platform"
            : "trainer",
      });
      if (usage.unpriced) return { skipped: "unpriced_calls" };
      const [adjusted] = await tx.query(
        "SELECT coalesce(sum((data->>'differenceMinor')::bigint),0)::text AS n FROM journals WHERE source_key LIKE $1",
        [`usage-adjustment:${period}:%`],
      );
      const charged = Number(statement.charge_minor) + Number(adjusted.n);
      const difference = usage.chargeMinor - charged;
      if (!difference) return { skipped: "no_difference" };
      await journal(
        tx,
        scope,
        source,
        AI_COACH_SERVICE_FEE + " adjustment",
        [
          { account: "trainer_payable", amount: difference },
          { account: "platform_cost_recovery", amount: -difference },
        ],
        {
          period,
          reference,
          differenceMinor: difference,
          previousChargedMinor: charged,
          currentChargeMinor: usage.chargeMinor,
          aedPerUsd: Number(statement.fx_aed_per_usd),
          markupPercent: usage.markupPercent,
          chargeableUsd: usage.chargeableUsd,
        },
      );
      const owners = await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner' ORDER BY user_id",
        [w.id],
      );
      const amount = (Math.abs(difference) / 100).toFixed(2);
      // Posted now: it is on this month's statement.
      const statementMonth = monthName(
        new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7),
      );
      for (const o of owners)
        await notifyUser(tx, scope, {
          userId: o.user_id,
          category: "account",
          dedupeKey: `ai-coach-service-fee:${period}:${referenceKey(reference)}`,
          title: `${AI_COACH_SERVICE_FEE} adjustment for ${monthName(period)}`,
          body:
            difference > 0
              ? `${AI_COACH_SERVICE_FEE} adjustment: AED ${amount} more for ${monthName(period)}. It is deducted from your earnings and shown on your ${statementMonth} statement.`
              : `${AI_COACH_SERVICE_FEE} adjustment: AED ${amount} back for ${monthName(period)}. It is added to your earnings and shown on your ${statementMonth} statement.`,
          href: "/trainer/finance",
          templateKey: "ai-coach-service-fee",
          email: false,
          source: { kind: "ai_coach_service_fee_adjustment", period },
        });
      return { differenceMinor: difference };
    });
    if (!outcome) continue;
    if ("differenceMinor" in outcome && outcome.differenceMinor !== undefined)
      posted.push({ tenantId: w.id, differenceMinor: outcome.differenceMinor });
    else skipped.push({ tenantId: w.id, reason: String((outcome as any).skipped) });
  }
  return { period, reference, posted, skipped };
}
