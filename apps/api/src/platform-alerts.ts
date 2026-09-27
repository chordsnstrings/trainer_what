import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { notifyUser } from "./notifications.ts";
import { platformWorkspaceSql } from "./workspace-state.ts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { pushAvailable } from "../../../packages/providers/src/push.ts";

// Operator alert engine. Rules observe conditions (never personal content) and
// return candidates; the engine de-duplicates by key, tracks each condition by
// a fingerprint, re-opens nothing an operator resolved unless the condition
// changed, resolves alerts whose condition cleared, and delivers new or
// escalated alerts to operators by role scope through the in-app inbox of a
// platform administration workspace they own and the existing email/push
// channels. Operators without one see alerts only in the operator inbox.

export type PlatformRole = "admin" | "finance" | "support" | "safety";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertCandidate = {
  /** Stable identity of the condition, e.g. "jobs.failed:<tenant id>". */
  dedupeKey: string;
  /** Changes when the observed condition changes (new items, new status). */
  fingerprint: string;
  severity: AlertSeverity;
  /** Operator roles that should see and receive it; Super admins always do. */
  scope: PlatformRole[];
  title: string;
  detail: string;
  tenantId?: string | null;
  data?: Record<string, unknown>;
};
export type TenantSignals = {
  tenantId: string;
  name: string;
  state: string;
  safetyWaiting: Array<{ id: string; created_at: string }>;
  deadJobs: Array<{ id: string; kind: string; status: string }>;
  uncertainEmails: Array<{ id: string; created_at: string }>;
  openReconciliations: Array<{ id: string; created_at: string }>;
  payoutProblems: Array<{ id: string; status: string; amount_minor: string }>;
};
export type AlertRuleContext = {
  db: Database;
  now: Date;
  /** Per-workspace signals, loaded once per evaluation and shared by rules. */
  tenantSignals: () => Promise<TenantSignals[]>;
};
export type PlatformAlertRule = {
  /** Lower-case rule id, e.g. "backups.stale". */
  id: string;
  description: string;
  evaluate: (context: AlertRuleContext) => Promise<AlertCandidate[]>;
};

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const ruleId = /^[a-z][a-z0-9_.-]{1,63}$/;
const severityRank: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};
const roles: PlatformRole[] = ["admin", "finance", "support", "safety"];
export const fingerprintOf = (values: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 40);
const hours = (from: string | Date, now: Date) =>
  Math.max(0, (now.getTime() - new Date(from).getTime()) / 3600000);

const registry = new Map<string, PlatformAlertRule>();
/**
 * Pluggable hook: another package registers a condition rule (for example
 * stale backups) at module load. Its alerts auto-resolve when the rule stops
 * returning them. Registering an existing id replaces that rule.
 */
export function registerPlatformAlertRule(rule: PlatformAlertRule) {
  if (!ruleId.test(rule.id))
    throw new Error("Alert rule ids use lower-case letters, digits, . _ -");
  registry.set(rule.id, rule);
}
export function platformAlertRules() {
  return [...registry.values()];
}

function normalize(candidate: AlertCandidate): AlertCandidate {
  const scope = [
    ...new Set<PlatformRole>([
      "admin",
      ...candidate.scope.filter((r) => roles.includes(r)),
    ]),
  ];
  return {
    ...candidate,
    dedupeKey: candidate.dedupeKey.slice(0, 300),
    fingerprint: candidate.fingerprint.slice(0, 128) || "none",
    title: candidate.title.slice(0, 160),
    detail: candidate.detail.slice(0, 2000) || candidate.title.slice(0, 160),
    scope,
    tenantId: candidate.tenantId ?? null,
    data: candidate.data ?? {},
  };
}

async function loadTenantSignals(db: Database, now: Date) {
  const tenants = await db.system((tx) =>
    tx.query<{ id: string; name: string; lifecycle_state: string }>(
      "SELECT id,name,lifecycle_state FROM tenants WHERE lifecycle_state IN ('active','suspended') ORDER BY id",
    ),
  );
  const waitMinutes = safetyWaitMinutes();
  const safetyCutoff = new Date(now.getTime() - waitMinutes * 60000);
  const recent = new Date(now.getTime() - 7 * 86400000);
  const payoutWindow = new Date(now.getTime() - 30 * 86400000);
  const signals: TenantSignals[] = [];
  for (const t of tenants)
    signals.push(
      await db.tenant(
        {
          tenantId: t.id,
          userId: "00000000-0000-0000-0000-000000000000",
          role: "owner",
        },
        async (tx) => ({
          tenantId: t.id,
          name: t.name,
          state: t.lifecycle_state,
          safetyWaiting: await tx.query(
            "SELECT id::text,created_at FROM records WHERE kind='exception' AND status='open' AND data->>'category'='safety' AND created_at<=$1 ORDER BY created_at,id LIMIT 200",
            [safetyCutoff],
          ),
          deadJobs: await tx.query(
            "SELECT id::text,kind,status FROM jobs WHERE (status='failed' OR (status='blocked' AND kind LIKE 'finance_%')) AND coalesce(available_at,created_at)>$1 ORDER BY id LIMIT 200",
            [recent],
          ),
          uncertainEmails: await tx.query(
            "SELECT id::text,created_at FROM jobs WHERE kind='email' AND status='blocked' AND data->>'deliveryState'='unknown' ORDER BY created_at,id LIMIT 200",
          ),
          openReconciliations: await tx.query(
            "SELECT id::text,created_at FROM records WHERE kind='reconciliation' AND status<>'resolved' ORDER BY created_at,id LIMIT 200",
          ),
          payoutProblems: await tx.query(
            "SELECT id::text,status,amount_minor::text FROM payouts WHERE status IN ('failed','returned','unknown') AND updated_at>$1 ORDER BY id LIMIT 50",
            [payoutWindow],
          ),
        }),
      ),
    );
  return signals;
}
export function safetyWaitMinutes() {
  const configured = Number(runtimeConfig().PLATFORM_ALERT_SAFETY_WAIT_MINUTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(10080, Math.max(15, Math.round(configured)))
    : 240;
}
const count = (n: number) => (n >= 200 ? "200 or more" : String(n));

// Built-in condition rules.
registerPlatformAlertRule({
  id: "infrastructure.threshold",
  description:
    "Infrastructure recommendations from the observer's reviewed thresholds.",
  async evaluate({ db }) {
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT id::text,service,rule,status,measured_value,threshold_value,created_at FROM infrastructure_recommendations WHERE status<>'resolved' ORDER BY id",
      ),
    );
    return rows.map((r) => ({
      dedupeKey: `infrastructure:${r.service}:${r.rule}`,
      fingerprint: r.id,
      severity: r.rule === "stale" ? "critical" : "warning",
      scope: ["admin"],
      title: `Infrastructure: ${r.service} ${String(r.rule).replaceAll("_", " ")}`,
      detail:
        r.rule === "stale"
          ? `The ${r.service} service has not reported a fresh observation.`
          : `The ${r.service} service measured ${Number(r.measured_value).toFixed(2)} against a threshold of ${Number(r.threshold_value).toFixed(2)}. Review it in Infrastructure status.`,
      data: {
        recommendationId: r.id,
        status: r.status,
        href: "/admin/infrastructure/observer",
      },
    }));
  },
});
registerPlatformAlertRule({
  id: "safety.escalation_waiting",
  description: "Open safety escalations waiting longer than the review window.",
  async evaluate({ tenantSignals, now }) {
    const wait = safetyWaitMinutes();
    return (await tenantSignals())
      .filter((t) => t.safetyWaiting.length)
      .map((t) => {
        const oldest = hours(t.safetyWaiting[0].created_at, now);
        return {
          dedupeKey: `safety.escalation_waiting:${t.tenantId}`,
          fingerprint: fingerprintOf(t.safetyWaiting.map((x) => x.id)),
          severity:
            oldest >= Math.max(24, (wait / 60) * 4) ? "critical" : "warning",
          scope: ["safety"],
          tenantId: t.tenantId,
          title: `Safety escalations waiting in ${t.name}`,
          detail: `${count(t.safetyWaiting.length)} open safety escalation(s) have waited longer than ${wait} minutes; the oldest has waited ${oldest.toFixed(1)} hours.${t.state === "suspended" ? " This workspace is suspended, so its coaches cannot respond in the app." : ""}`,
          data: {
            waiting: t.safetyWaiting.length,
            oldestHours: Math.round(oldest * 10) / 10,
            href: "/admin/safety",
          },
        } satisfies AlertCandidate;
      });
  },
});
registerPlatformAlertRule({
  id: "jobs.failed",
  description:
    "Background jobs that failed permanently or are blocked for review (last 7 days).",
  async evaluate({ tenantSignals }) {
    return (await tenantSignals())
      .filter((t) => t.deadJobs.length)
      .map((t) => {
        const finance = t.deadJobs.some((j) => j.kind.startsWith("finance_"));
        const kinds = [...new Set(t.deadJobs.map((j) => j.kind))].sort();
        return {
          dedupeKey: `jobs.failed:${t.tenantId}`,
          fingerprint: fingerprintOf(
            t.deadJobs.map((j) => j.id + ":" + j.status),
          ),
          severity: "warning",
          scope: finance ? ["finance"] : [],
          tenantId: t.tenantId,
          title: `Failed or blocked jobs in ${t.name}`,
          detail: `${count(t.deadJobs.length)} job(s) failed or are blocked for review (${kinds.join(", ")}). Review them in the jobs view before any retry.`,
          data: {
            jobs: t.deadJobs.length,
            kinds,
            href: "/admin/infrastructure",
          },
        } satisfies AlertCandidate;
      });
  },
});
registerPlatformAlertRule({
  id: "finance.reconciliation_open",
  description: "Open reconciliation exceptions and finance follow-ups.",
  async evaluate({ tenantSignals, now }) {
    return (await tenantSignals())
      .filter((t) => t.openReconciliations.length)
      .map((t) => {
        const oldest = hours(t.openReconciliations[0].created_at, now);
        return {
          dedupeKey: `finance.reconciliation_open:${t.tenantId}`,
          fingerprint: fingerprintOf(t.openReconciliations.map((x) => x.id)),
          severity: oldest >= 7 * 24 ? "critical" : "warning",
          scope: ["finance"],
          tenantId: t.tenantId,
          title: `Reconciliation exceptions open in ${t.name}`,
          detail: `${count(t.openReconciliations.length)} reconciliation exception(s) or finance follow-up(s) are open; the oldest is ${Math.floor(oldest / 24)} day(s) old. Monthly close waits for them.`,
          data: { open: t.openReconciliations.length, href: "/admin/finance" },
        } satisfies AlertCandidate;
      });
  },
});
registerPlatformAlertRule({
  id: "email.delivery_uncertain",
  description:
    "Emails whose provider outcome is unknown and need reconciliation.",
  async evaluate({ tenantSignals, now }) {
    return (await tenantSignals())
      .filter((t) => t.uncertainEmails.length)
      .map(
        (t) =>
          ({
            dedupeKey: `email.delivery_uncertain:${t.tenantId}`,
            fingerprint: fingerprintOf(t.uncertainEmails.map((x) => x.id)),
            severity: "warning",
            scope: [],
            tenantId: t.tenantId,
            title: `Email delivery outcome unknown in ${t.name}`,
            detail: `${count(t.uncertainEmails.length)} email(s) were handed to the provider without a confirmed outcome (oldest ${hours(t.uncertainEmails[0].created_at, now).toFixed(1)} hours). Reconcile provider evidence before any resend.`,
            data: {
              uncertain: t.uncertainEmails.length,
              href: "/admin/infrastructure",
            },
          }) satisfies AlertCandidate,
      );
  },
});
registerPlatformAlertRule({
  id: "finance.payout_failure",
  description:
    "Trainer payouts that failed, were returned or have an unknown outcome (last 30 days).",
  async evaluate({ tenantSignals }) {
    return (await tenantSignals()).flatMap((t) =>
      t.payoutProblems.map(
        (p) =>
          ({
            dedupeKey: `finance.payout_failure:${p.id}`,
            fingerprint: p.status,
            severity: p.status === "returned" ? "warning" : "critical",
            scope: ["finance"],
            tenantId: t.tenantId,
            title: `Payout ${p.status} for ${t.name}`,
            detail: `A trainer payout of AED ${(Number(p.amount_minor) / 100).toFixed(2)} is ${p.status}. ${p.status === "unknown" ? "Reconcile the bank outcome before any new instruction." : "Record bank evidence and prepare a corrected revision after review."}`,
            data: { payoutId: p.id, status: p.status, href: "/admin/finance" },
          }) satisfies AlertCandidate,
      ),
    );
  },
});

async function upsertAlert(
  tx: Tx,
  rule: string,
  c: AlertCandidate,
  now: Date,
): Promise<"opened" | "escalated" | "updated" | "unchanged" | "suppressed"> {
  const [active] = await tx.query(
    "SELECT * FROM platform_alerts WHERE dedupe_key=$1 AND status<>'resolved' FOR UPDATE",
    [c.dedupeKey],
  );
  if (active) {
    const changed =
      active.fingerprint !== c.fingerprint || active.severity !== c.severity;
    const escalated =
      severityRank[c.severity] > severityRank[active.severity as AlertSeverity];
    await tx.query(
      `UPDATE platform_alerts SET last_seen_at=$2,title=$3,detail=$4,data=$5,scope=$6::text[],tenant_id=$7${changed ? ",fingerprint=$8,severity=$9,occurrences=occurrences+1,revision=revision+1,updated_at=now()" : ""}${escalated ? ",status='open'" : ""} WHERE id=$1`,
      [
        active.id,
        now,
        c.title,
        c.detail,
        JSON.stringify(c.data ?? {}),
        c.scope,
        c.tenantId ?? null,
        ...(changed ? [c.fingerprint, c.severity] : []),
      ],
    );
    return escalated ? "escalated" : changed ? "updated" : "unchanged";
  }
  // An operator resolution holds while the observed condition is unchanged.
  const [last] = await tx.query(
    "SELECT fingerprint,resolution FROM platform_alerts WHERE dedupe_key=$1 AND status='resolved' ORDER BY resolved_at DESC LIMIT 1",
    [c.dedupeKey],
  );
  if (last?.resolution === "operator" && last.fingerprint === c.fingerprint)
    return "suppressed";
  await tx.query(
    "INSERT INTO platform_alerts(id,rule,dedupe_key,fingerprint,severity,scope,tenant_id,title,detail,data,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,$11,$11)",
    [
      randomUUID(),
      rule,
      c.dedupeKey,
      c.fingerprint,
      c.severity,
      c.scope,
      c.tenantId ?? null,
      c.title,
      c.detail,
      JSON.stringify(c.data ?? {}),
      now,
    ],
  );
  return "opened";
}

/**
 * Evaluates every registered rule (or the given ones) and persists the result.
 * A rule that throws keeps its existing alerts untouched for this cycle.
 */
export async function evaluatePlatformAlerts(
  db: Database,
  options: { now?: Date; rules?: PlatformAlertRule[] } = {},
) {
  const now = options.now ?? new Date();
  let signals: Promise<TenantSignals[]> | undefined;
  const context: AlertRuleContext = {
    db,
    now,
    tenantSignals: () => (signals ??= loadTenantSignals(db, now)),
  };
  const evaluated: Array<{ rule: string; candidates: AlertCandidate[] }> = [];
  const failedRules: string[] = [];
  for (const rule of options.rules ?? platformAlertRules()) {
    try {
      const seen = new Set<string>();
      const candidates = (await rule.evaluate(context))
        .map(normalize)
        .filter((c) => !seen.has(c.dedupeKey) && seen.add(c.dedupeKey));
      evaluated.push({ rule: rule.id, candidates });
    } catch {
      failedRules.push(rule.id);
    }
  }
  const summary = await db.system(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('platform-alerts'))");
    const counts = {
      opened: 0,
      escalated: 0,
      updated: 0,
      resolved: 0,
      suppressed: 0,
    };
    for (const { rule, candidates } of evaluated) {
      for (const c of candidates) {
        const outcome = await upsertAlert(tx, rule, c, now);
        if (outcome !== "unchanged") counts[outcome]++;
      }
      const cleared = await tx.query(
        "UPDATE platform_alerts SET status='resolved',resolution='condition_cleared',resolved_at=$3,revision=revision+1,updated_at=now() WHERE rule=$1 AND status<>'resolved' AND NOT (dedupe_key=ANY($2::text[])) RETURNING id",
        [rule, candidates.map((c) => c.dedupeKey), now],
      );
      counts.resolved += cleared.length;
    }
    return counts;
  });
  const delivered = await deliverPlatformAlerts(db);
  return { ...summary, delivered, failedRules, rules: evaluated.length };
}

/**
 * Records an event-driven alert (for example a failed backup run). It is not
 * auto-resolved by evaluation; operators resolve it, or call clearPlatformAlert.
 */
export async function raisePlatformAlert(
  db: Database,
  rule: string,
  candidate: AlertCandidate,
  now = new Date(),
) {
  if (!ruleId.test(rule)) throw new Error("Invalid alert rule id");
  if (registry.has(rule))
    throw new Error("Condition rules are raised by evaluation, not directly");
  const outcome = await db.system(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('platform-alerts'))");
    return upsertAlert(tx, rule, normalize(candidate), now);
  });
  await deliverPlatformAlerts(db);
  return outcome;
}
export async function clearPlatformAlert(db: Database, dedupeKey: string) {
  return db.system(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('platform-alerts'))");
    const rows = await tx.query(
      "UPDATE platform_alerts SET status='resolved',resolution='condition_cleared',resolved_at=now(),revision=revision+1,updated_at=now() WHERE dedupe_key=$1 AND status<>'resolved' RETURNING id",
      [dedupeKey],
    );
    return rows.length;
  });
}

const emailConfigured = () => {
  const c = runtimeConfig();
  return !!(c.EMAIL_API_KEY && c.EMAIL_API_URL && c.EMAIL_FROM);
};
/**
 * Delivers every open alert to each eligible, unlocked operator who has not
 * received it at its current severity. Idempotent: the delivery row and the
 * notification dedupe key both prevent repeats; failures retry next cycle.
 */
export async function deliverPlatformAlerts(db: Database, limit = 200) {
  const pending = await db.system((tx) =>
    tx.query(
      "SELECT a.id,a.severity,a.title,a.detail,a.data,u.id AS user_id FROM platform_alerts a JOIN users u ON u.platform_role<>'none' AND (u.platform_role='admin' OR u.platform_role=ANY(a.scope)) WHERE a.status='open' AND NOT EXISTS(SELECT 1 FROM platform_alert_deliveries d WHERE d.alert_id=a.id AND d.user_id=u.id AND d.severity=a.severity) AND NOT EXISTS(SELECT 1 FROM account_locks l WHERE l.user_id=u.id AND l.status='active') ORDER BY a.first_seen_at,a.id,u.id LIMIT $1",
      [limit],
    ),
  );
  let delivered = 0;
  for (const p of pending) {
    try {
      // Alert text names other workspaces, so it is stored only in a platform
      // administration workspace the operator owns, never in a trainer
      // workspace they follow or staff (whose owner could read it).
      const [home] = await db.system((tx) =>
        tx.query(
          "SELECT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.role='owner' AND t.lifecycle_state='active' AND " +
            platformWorkspaceSql("t.id") +
            " ORDER BY (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id=m.user_id AND s.tenant_id=m.tenant_id) DESC NULLS LAST,m.tenant_id LIMIT 1",
          [p.user_id],
        ),
      );
      if (!home) {
        await db.system((tx) =>
          tx.query(
            "INSERT INTO platform_alert_deliveries(id,alert_id,user_id,severity,status) VALUES($1,$2,$3,$4,'no_workspace') ON CONFLICT DO NOTHING",
            [randomUUID(), p.id, p.user_id, p.severity],
          ),
        );
        continue;
      }
      const email = emailConfigured() && p.severity !== "info",
        push = p.severity === "critical";
      const actor: Actor = {
        tenantId: home.tenant_id,
        userId: p.user_id,
        role: "owner",
      };
      const notification = await db.tenant(actor, (tx) =>
        notifyUser(tx, actor, {
          userId: p.user_id,
          category: "account",
          dedupeKey: `platform-alert:${p.id}:${p.severity}`,
          title: `${p.severity === "critical" ? "Critical" : p.severity === "warning" ? "Warning" : "Notice"}: ${p.title}`,
          body: `${p.detail}\n\nReview it in the operator alert inbox.`,
          href: "/admin/alerts",
          templateKey: "platform-alert",
          email,
          push,
          source: { kind: "platform_alert", alertId: p.id },
        }),
      );
      await db.system((tx) =>
        tx.query(
          "INSERT INTO platform_alert_deliveries(id,alert_id,user_id,tenant_id,severity,status,notification_id,channels) VALUES($1,$2,$3,$4,$5,'delivered',$6,$7::text[]) ON CONFLICT DO NOTHING",
          [
            randomUUID(),
            p.id,
            p.user_id,
            home.tenant_id,
            p.severity,
            notification?.id ?? null,
            [
              "in_app",
              ...(email ? ["email"] : []),
              ...(push && pushAvailable() ? ["push"] : []),
            ],
          ],
        ),
      );
      delivered++;
    } catch {
      // Retried on the next evaluation; never log alert or operator details.
      console.error("Platform alert delivery could not be recorded");
    }
  }
  return delivered;
}

export function registerPlatformAlerts(
  app: FastifyInstance,
  db: Database,
  identity: (
    req: FastifyRequest,
  ) => Actor & { platformRole: string; mfaAt?: string | null },
) {
  const operator = (req: FastifyRequest) => {
    const a = identity(req);
    if (!roles.includes(a.platformRole as PlatformRole))
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Platform operator access is required.",
      );
    requireRecentMfa(a, true);
    return a;
  };
  const visible = "($1='admin' OR $1=ANY(a.scope))";
  const audit = (
    tx: Tx,
    a: Actor,
    action: string,
    subject: string | null,
    data: unknown = {},
  ) =>
    tx.query(
      "INSERT INTO admin_operations_audit(id,actor_id,action,tenant_id,subject_id,data) VALUES($1,$2,$3,NULL,$4,$5)",
      [randomUUID(), a.userId, action, subject, JSON.stringify(data)],
    );
  app.get("/api/v1/admin/alerts", async (req) => {
    const a = operator(req);
    const q = z
      .object({
        status: z
          .enum(["active", "open", "acknowledged", "resolved"])
          .default("active"),
        page: z.coerce.number().int().min(0).max(1000).default(0),
      })
      .parse(req.query);
    return db.system(async (tx) => {
      const alerts = await tx.query(
        `SELECT a.id,a.rule,a.severity,a.scope,a.status,a.title,a.detail,a.data,a.tenant_id,t.name AS workspace,a.occurrences,a.first_seen_at,a.last_seen_at,a.acknowledged_at,ab.name AS acknowledged_by,a.acknowledgement_note,a.resolved_at,rb.name AS resolved_by,a.resolution,a.resolution_note,a.revision,(SELECT count(*)::int FROM platform_alert_deliveries d WHERE d.alert_id=a.id AND d.status='delivered') AS deliveries FROM platform_alerts a LEFT JOIN tenants t ON t.id=a.tenant_id LEFT JOIN users ab ON ab.id=a.acknowledged_by LEFT JOIN users rb ON rb.id=a.resolved_by WHERE ${visible} AND (CASE WHEN $2='active' THEN a.status<>'resolved' ELSE a.status=$2 END) ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,a.last_seen_at DESC,a.id LIMIT 51 OFFSET $3`,
        [a.platformRole, q.status, q.page * 50],
      );
      const [counts] = await tx.query(
        `SELECT count(*) FILTER(WHERE a.status='open')::int AS open,count(*) FILTER(WHERE a.status='acknowledged')::int AS acknowledged,count(*) FILTER(WHERE a.status<>'resolved' AND a.severity='critical')::int AS critical FROM platform_alerts a WHERE ${visible}`,
        [a.platformRole],
      );
      return {
        alerts: alerts.slice(0, 50),
        hasMore: alerts.length > 50,
        page: q.page,
        status: q.status,
        counts,
        canEvaluate: a.platformRole === "admin",
      };
    });
  });
  for (const action of ["acknowledge", "resolve"] as const)
    app.post(`/api/v1/admin/alerts/:id/${action}`, async (req) => {
      const a = operator(req),
        id = z
          .string()
          .uuid()
          .parse((req.params as any).id),
        b = z
          .object({
            revision: z.number().int().positive(),
            note:
              action === "resolve"
                ? z.string().trim().min(10).max(1000)
                : z.string().trim().max(1000).optional(),
          })
          .strict()
          .parse(req.body);
      return db.system(async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtext('platform-alerts'))",
        );
        const [row] = await tx.query(
          `SELECT * FROM platform_alerts a WHERE a.id=$2 AND ${visible} FOR UPDATE`,
          [a.platformRole, id],
        );
        if (!row) throw fail(404, "ALERT_NOT_FOUND", "Alert unavailable.");
        if (
          row.revision !== b.revision ||
          row.status === "resolved" ||
          (action === "acknowledge" && row.status !== "open")
        )
          throw fail(
            409,
            "REVISION_CONFLICT",
            "This alert changed. Reload before continuing.",
          );
        const [updated] = await tx.query(
          action === "acknowledge"
            ? "UPDATE platform_alerts SET status='acknowledged',acknowledged_by=$2,acknowledged_at=now(),acknowledgement_note=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *"
            : "UPDATE platform_alerts SET status='resolved',resolution='operator',resolved_by=$2,resolved_at=now(),resolution_note=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, a.userId, b.note ?? null],
        );
        await audit(tx, a, "alert." + action + "d", id, {
          rule: row.rule,
          severity: row.severity,
        });
        return updated;
      });
    });
  app.post("/api/v1/admin/alerts/evaluate", async (req) => {
    const a = operator(req);
    if (a.platformRole !== "admin")
      throw fail(
        403,
        "SUPERADMIN_REQUIRED",
        "Only a Super admin can run alert checks.",
      );
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const result = await evaluatePlatformAlerts(db);
    await db.system((tx) => audit(tx, a, "alert.evaluated", null, result));
    return result;
  });
}
