import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { readFile, statfs } from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { sandboxResolver } from "../../../packages/providers/src/sandbox.ts";
import { HOST_HEADERS } from "./host-routing.ts";
import { requireRecentMfa } from "./security.ts";

/**
 * Host operations for the single-server deployment: signed host status reports,
 * backup status, allowlisted host action requests, the edge's on-demand TLS
 * "ask" endpoint and platform-address validation.
 *
 * The host controller (infra/digitalocean/hostops.py) reads and writes these
 * tables through the migration administrator. Requests and results are
 * HMAC-signed with a key derived from INTERNAL_PROXY_SECRET, which both the
 * API and the controller already hold; nothing else is shared.
 */

type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const ms = (value: unknown) =>
  value instanceof Date ? value.getTime() : Date.parse(String(value));

export const TLS_ASK_PATH = "/api/v1/internal/tls/ask";
const HOST_KEY_LABEL = "gymmembership-host-operations-v1";
const TLS_ASK_LABEL = "gymmembership-tls-ask-v1";
/** Requests not picked up by the controller within this window expire. */
export const HOST_ACTION_TTL_MS = 30 * 60 * 1000;
/** A running request without a reported result after this is shown as unknown. */
const RUNNING_UNKNOWN_MS = 45 * 60 * 1000;
const ACTIONS_PER_HOUR = 12;
/** A signed report may claim a time at most this far ahead of the API clock. */
const REPORT_CLOCK_SKEW_MS = 5 * 60 * 1000;

function proxySecret(secret = process.env.INTERNAL_PROXY_SECRET) {
  return secret && Buffer.byteLength(secret) >= 32 ? secret : null;
}
/** Derived signing key shared with the host controller; null without a secret. */
export function hostOperationsKey(secret?: string): Buffer | null {
  const value = proxySecret(secret ?? process.env.INTERNAL_PROXY_SECRET);
  return value
    ? createHmac("sha256", value).update(HOST_KEY_LABEL).digest()
    : null;
}
/** Token the edge appends to its ask URL; derived, never the secret itself. */
export function tlsAskToken(secret?: string): string | null {
  const value = proxySecret(secret ?? process.env.INTERNAL_PROXY_SECRET);
  return value
    ? createHmac("sha256", value).update(TLS_ASK_LABEL).digest("hex")
    : null;
}
const hmac = (key: Buffer, text: string) =>
  createHmac("sha256", key).update(text, "utf8").digest("hex");
function sameHex(a: string | null | undefined, b: string) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export type HostActionIntent = {
  id: string;
  requestId: string;
  action: HostAction;
  target: string | null;
  requestedBy: string;
  issuedAtMs: number;
  expiresAtMs: number;
  reason: string;
};
/** Canonical text the controller recomputes; see hostops.py action_canonical. */
export function hostActionCanonical(intent: HostActionIntent) {
  return [
    "gymmembership-host-action-v1",
    intent.id,
    intent.requestId,
    intent.action,
    intent.target ?? "-",
    intent.requestedBy,
    String(intent.issuedAtMs),
    String(intent.expiresAtMs),
    sha256(intent.reason),
  ].join("\n");
}
export function signHostAction(intent: HostActionIntent, key: Buffer) {
  return hmac(key, hostActionCanonical(intent));
}
export function signHostResult(
  key: Buffer,
  id: string,
  status: string,
  result: string,
) {
  return hmac(
    key,
    ["gymmembership-host-result-v1", id, status, result].join("\n"),
  );
}
export function signHostStatus(key: Buffer, source: string, payload: string) {
  return hmac(
    key,
    ["gymmembership-host-status-v1", source, payload].join("\n"),
  );
}

export const hostActions = {
  restart_service: {
    label: "Restart a service",
    targets: ["api", "web", "worker"],
    description:
      "Recreates one container from the release that is serving now and waits for it to become ready. In-flight requests to that service are interrupted.",
  },
  rollback_release: {
    label: "Roll back to the previous release",
    targets: [],
    description:
      "Serves the previous deployed release and pauses automatic deploys. Database migrations are not reversed; the previous release must be compatible with the current schema.",
  },
  restore_release: {
    label: "Return to the latest deployed release",
    targets: [],
    description:
      "After a rollback, serves the most recent deployed release again. Automatic deploys stay as they are.",
  },
  reapply_release: {
    label: "Re-apply runtime settings",
    targets: [],
    description:
      "Recreates api, web, worker and the HTTPS edge from the serving release with the current private runtime settings, for example after changing the platform address. Nothing is rolled back automatically if the new settings fail their readiness check.",
  },
  pause_deploys: {
    label: "Pause automatic deploys",
    targets: [],
    description:
      "The server stops deploying new checked main commits until deploys are resumed. Running services are unchanged.",
  },
  resume_deploys: {
    label: "Resume automatic deploys",
    targets: [],
    description:
      "The server deploys the current checked main commit again on its next cycle, if it differs from the recorded release.",
  },
  backup_now: {
    label: "Back up the database now",
    targets: [],
    description:
      "Takes an encrypted, checksummed custom-format dump now and uploads it off-server when that storage is configured.",
  },
  verify_backup: {
    label: "Verify the latest backup",
    targets: [],
    description:
      "Checks the latest backup's checksum and authentication tag, restores it into a temporary scratch database, verifies its migrations and tables, then drops the scratch database. Needs free disk space of about one and a half times the database plus room for its write-ahead log; it refuses to start without it and stops if space runs low.",
  },
} as const;
export type HostAction = keyof typeof hostActions;
const actionNames = Object.keys(hostActions) as [HostAction, ...HostAction[]];

export const hostThresholds = z
  .object({
    reportFreshnessSeconds: z.number().int().min(300).max(86400),
    diskWarnPercent: z.number().min(1).max(100),
    diskCriticalPercent: z.number().min(1).max(100),
    memoryAvailableWarnPercent: z.number().min(0).max(100),
    memoryAvailableCriticalPercent: z.number().min(0).max(100),
    loadPerCpuWarn: z.number().min(0.1).max(100),
    loadPerCpuCritical: z.number().min(0.1).max(100),
    backupWarnAgeHours: z.number().min(1).max(720),
    backupCriticalAgeHours: z.number().min(1).max(720),
  })
  .strict()
  .refine(
    (t) =>
      t.diskWarnPercent <= t.diskCriticalPercent &&
      t.memoryAvailableWarnPercent >= t.memoryAvailableCriticalPercent &&
      t.loadPerCpuWarn <= t.loadPerCpuCritical &&
      t.backupWarnAgeHours <= t.backupCriticalAgeHours,
    "Each warning level must come before its critical level",
  );
export type HostThresholds = z.infer<typeof hostThresholds>;

const sha = z
  .string()
  .regex(/^[0-9a-f]{40}$/)
  .nullable();
const bytes = z.number().finite().min(0);
const shortText = z.string().max(500);
const backupRecord = z.object({
  name: z.string().max(100),
  createdAt: z.string().max(40),
  sizeBytes: bytes,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  keyId: z.string().max(64).optional(),
  kind: z.string().max(20).optional(),
  location: z.enum(["local", "local+offsite"]),
  offsite: z
    .object({
      status: z.enum(["uploaded", "failed", "not_configured"]),
      at: z.string().max(40).nullable().optional(),
      objectKey: z.string().max(300).nullable().optional(),
      error: shortText.nullable().optional(),
    })
    .optional(),
});
const controllerReport = z.object({
  version: z.literal(1),
  generatedAt: z.string().max(40),
  controllerRelease: sha.optional(),
  host: z
    .object({
      cpuCount: z.number().int().min(1).max(4096).nullable(),
      load: z.array(z.number().finite().min(0)).length(3).nullable(),
      uptimeSeconds: z.number().finite().min(0).nullable(),
      memory: z
        .object({
          totalBytes: bytes,
          availableBytes: bytes,
          swapTotalBytes: bytes,
          swapFreeBytes: bytes,
        })
        .nullable(),
      disks: z
        .array(
          z.object({
            mount: z.string().max(200),
            totalBytes: bytes,
            usedBytes: bytes,
            freeBytes: bytes,
          }),
        )
        .max(8),
    })
    .nullable(),
  containers: z
    .array(
      z.object({
        service: z.string().max(40),
        state: z.string().max(40),
        health: z.string().max(40).nullable(),
        exitCode: z.number().int().nullable(),
      }),
    )
    .max(20)
    .nullable(),
  edge: z
    .object({
      /** The served Caddyfile has the on-demand block. */
      onDemandTls: z.boolean(),
      /** runtime.env asks for it (absent from older controllers). */
      onDemandConfigured: z.boolean().optional(),
      /** The served Caddyfile differs from what the current settings render. */
      pendingReapply: z.boolean().optional(),
      endpoint: z.string().max(300),
    })
    .nullable()
    .optional(),
  deploy: z
    .object({
      current: sha,
      previous: sha,
      serving: sha,
      deployedAt: z.number().nullable(),
      paused: z.boolean(),
      pausedAt: z.number().nullable(),
      pausedReason: shortText.nullable().optional(),
    })
    .nullable(),
  backups: z
    .object({
      policy: z.object({
        intervalHours: z.number().min(1).max(168),
        keep: z.number().int().min(1).max(365),
        offsite: z.enum(["configured", "not_configured", "invalid"]),
      }),
      count: z.number().int().min(0),
      totalBytes: bytes,
      latest: backupRecord.nullable(),
      lastAttemptAt: z.string().max(40).nullable(),
      lastFailure: z
        .object({ at: z.string().max(40), message: shortText })
        .nullable(),
      lastVerification: z
        .object({
          at: z.string().max(40),
          ok: z.boolean(),
          backup: z.string().max(100).nullable(),
          message: shortText,
        })
        .nullable(),
      nextDueAt: z.string().max(40).nullable(),
    })
    .nullable(),
});
export type ControllerReport = z.infer<typeof controllerReport>;
const apiReport = z.object({
  version: z.literal(1),
  generatedAt: z.string().max(40),
  cpuCount: z.number().int().min(1).max(4096),
  load: z.array(z.number().finite().min(0)).length(3),
  memory: z.object({ totalBytes: bytes, availableBytes: bytes }),
  disk: z
    .object({
      mount: z.literal("/"),
      totalBytes: bytes,
      usedBytes: bytes,
      freeBytes: bytes,
    })
    .nullable(),
});

async function currentThresholds(tx: Tx) {
  const [row] = await tx.query(
    "SELECT * FROM host_monitor_policies ORDER BY revision DESC LIMIT 1",
  );
  return {
    revision: Number(row.revision),
    thresholds: hostThresholds.parse(row.thresholds),
    reason: String(row.reason),
    createdAt: row.created_at,
  };
}
type StatusRow = {
  source: string;
  payload: string;
  signature: string | null;
  reported_at: unknown;
};
/**
 * A verified report's time is its signed `generatedAt`, never the unsigned
 * `reported_at` column: anyone able to write the row could otherwise replay an
 * old signed report as current. `reportedAtMs` is null when nothing verifies.
 */
function readController(
  row: StatusRow | undefined,
  key: Buffer | null,
  now: number,
) {
  if (!row)
    return {
      state: "unreported" as const,
      report: null,
      reportedAtMs: null,
    };
  const verified =
    !!key &&
    sameHex(row.signature, signHostStatus(key, "controller", row.payload));
  let report: ControllerReport | null = null;
  try {
    report = controllerReport.parse(JSON.parse(row.payload));
  } catch {
    return { state: "invalid" as const, report: null, reportedAtMs: null };
  }
  if (!verified)
    return { state: "unverified" as const, report: null, reportedAtMs: null };
  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > now + REPORT_CLOCK_SKEW_MS)
    return { state: "invalid" as const, report: null, reportedAtMs: null };
  return {
    state: "verified" as const,
    report,
    reportedAtMs: generatedAt,
  };
}
async function statusRows(tx: Tx) {
  const rows = await tx.query<StatusRow>(
    "SELECT source,payload,signature,reported_at FROM host_status",
  );
  return {
    controller: rows.find((r) => r.source === "controller"),
    api: rows.find((r) => r.source === "api"),
  };
}

export type BackupStatus = {
  /** healthy, warning (older than warning age), stale (older than critical age),
   * missing (reported, but no successful backup), unreported (no verified
   * controller report), report_stale (no verified report for longer than the
   * backup warning age, so backups cannot be judged). */
  state:
    "healthy" | "warning" | "stale" | "missing" | "unreported" | "report_stale";
  /** True when an operator should be alerted about backups. */
  stale: boolean;
  message: string;
  /** Signed time of the controller report the status is based on. */
  reportedAt: string | null;
  /** That report is older than the host report freshness threshold. A
   * separate signal from backup age: deployments delay reports. */
  reportStale: boolean;
  lastSuccessAt: string | null;
  ageHours: number | null;
  sizeBytes: number | null;
  location: "local" | "local+offsite" | null;
  offsite: "uploaded" | "failed" | "not_configured" | "invalid" | null;
  name: string | null;
  sha256: string | null;
  count: number;
  lastFailure: { at: string; message: string } | null;
  lastVerification: {
    at: string;
    ok: boolean;
    backup: string | null;
    message: string;
  } | null;
  policy: { intervalHours: number; keep: number } | null;
  thresholds: { warnAgeHours: number; criticalAgeHours: number };
};
function backupStatusFrom(
  controller: ReturnType<typeof readController>,
  thresholds: HostThresholds,
  now: number,
): BackupStatus {
  const base = {
    reportedAt: null,
    reportStale: false,
    lastSuccessAt: null,
    ageHours: null,
    sizeBytes: null,
    location: null,
    offsite: null,
    name: null,
    sha256: null,
    count: 0,
    lastFailure: null,
    lastVerification: null,
    policy: null,
    thresholds: {
      warnAgeHours: thresholds.backupWarnAgeHours,
      criticalAgeHours: thresholds.backupCriticalAgeHours,
    },
  };
  if (controller.state !== "verified" || !controller.report?.backups)
    return {
      ...base,
      state: "unreported",
      stale: true,
      message:
        controller.state === "unverified" || controller.state === "invalid"
          ? "The latest host report could not be verified, so backup evidence is unavailable."
          : "No host controller has reported backup status. Backups cannot be confirmed.",
    };
  const b = controller.report.backups,
    reportedAtMs = controller.reportedAtMs ?? 0,
    reportedAt = new Date(reportedAtMs).toISOString(),
    reportAge = Math.max(0, (now - reportedAtMs) / 1000),
    reportStale = reportAge > thresholds.reportFreshnessSeconds;
  const latest = b.latest,
    successAt = latest ? Date.parse(latest.createdAt) : NaN,
    ageHours = Number.isFinite(successAt)
      ? Math.max(0, (now - successAt) / 3600000)
      : null;
  const detail = {
    ...base,
    reportedAt,
    reportStale,
    lastSuccessAt: latest ? new Date(successAt).toISOString() : null,
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    sizeBytes: latest?.sizeBytes ?? null,
    location: latest?.location ?? null,
    offsite:
      b.policy.offsite === "invalid"
        ? ("invalid" as const)
        : (latest?.offsite?.status ?? null),
    name: latest?.name ?? null,
    sha256: latest?.sha256 ?? null,
    count: b.count,
    lastFailure: b.lastFailure,
    lastVerification: b.lastVerification,
    policy: { intervalHours: b.policy.intervalHours, keep: b.policy.keep },
  };
  // A long deployment delays the controller's report; that alone says nothing
  // about backups, whose age is measured from the last verified report's
  // newest backup. Only a report silent for longer than the backup warning
  // age leaves backups unjudgeable.
  if (reportAge > thresholds.backupWarnAgeHours * 3600)
    return {
      ...detail,
      state: "report_stale",
      stale: true,
      message: `The host controller has not reported for ${Math.round(reportAge / 3600)} hours; backups cannot be confirmed.`,
    };
  const note = reportStale
    ? ` The host controller last reported ${reportAge < 7200 ? `${Math.round(reportAge / 60)} minutes` : `${Math.round(reportAge / 3600)} hours`} ago.`
    : "";
  if (ageHours === null)
    return {
      ...detail,
      state: "missing",
      stale: true,
      message:
        (b.lastFailure
          ? "No successful backup exists yet. The last attempt failed."
          : "No successful backup exists yet.") + note,
    };
  if (ageHours > thresholds.backupCriticalAgeHours)
    return {
      ...detail,
      state: "stale",
      stale: true,
      message: `The latest successful backup is ${Math.round(ageHours)} hours old.${note}`,
    };
  if (ageHours > thresholds.backupWarnAgeHours)
    return {
      ...detail,
      state: "warning",
      stale: true,
      message: `The latest successful backup is ${Math.round(ageHours)} hours old; a daily backup is overdue.${note}`,
    };
  return {
    ...detail,
    state: "healthy",
    stale: false,
    message:
      (latest?.location === "local+offsite"
        ? "The latest backup is recent and stored on the server and off-server."
        : "The latest backup is recent. It is stored on this server only.") +
      note,
  };
}

/**
 * Backup status for dashboards and stale-backup alerts. `stale` is true when
 * the latest verified backup is older than the configured warning age, when no
 * successful backup exists, when no verified host report is available, or when
 * the controller has been silent for longer than the backup warning age. A
 * report delayed by a deployment sets only `reportStale`.
 */
export async function readBackupStatus(
  db: Database,
  options: { now?: number } = {},
): Promise<BackupStatus> {
  const now = options.now ?? Date.now();
  return db.system(async (tx) => {
    const policy = await currentThresholds(tx);
    const { controller } = await statusRows(tx);
    return backupStatusFrom(
      readController(controller, hostOperationsKey(), now),
      policy.thresholds,
      now,
    );
  });
}

type Level = "ok" | "warning" | "critical" | "unavailable" | "info";
type MetricView = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: Level;
  warning: number | null;
  critical: number | null;
  detail: string;
};
const EXPECTED_SERVICES = ["database", "api", "web", "worker", "edge"];
function above(value: number, warn: number, critical: number): Level {
  return value >= critical ? "critical" : value >= warn ? "warning" : "ok";
}
function hostMetrics(
  host: {
    cpuCount: number | null;
    load: number[] | null;
    memory: { totalBytes: number; availableBytes: number } | null;
    disks: {
      mount: string;
      totalBytes: number;
      usedBytes: number;
      freeBytes: number;
    }[];
  },
  t: HostThresholds,
): MetricView[] {
  const metrics: MetricView[] = [];
  for (const disk of host.disks) {
    const percent =
      disk.totalBytes > 0 ? (100 * disk.usedBytes) / disk.totalBytes : null;
    metrics.push({
      key: "disk:" + disk.mount,
      label: `Disk used (${disk.mount})`,
      value: percent === null ? null : Number(percent.toFixed(1)),
      unit: "%",
      status:
        percent === null
          ? "unavailable"
          : above(percent, t.diskWarnPercent, t.diskCriticalPercent),
      warning: t.diskWarnPercent,
      critical: t.diskCriticalPercent,
      detail: `${(disk.freeBytes / 1073741824).toFixed(1)} GiB free of ${(disk.totalBytes / 1073741824).toFixed(1)} GiB`,
    });
  }
  const memory = host.memory,
    available =
      memory && memory.totalBytes > 0
        ? (100 * memory.availableBytes) / memory.totalBytes
        : null;
  metrics.push({
    key: "memory_available",
    label: "Memory available",
    value: available === null ? null : Number(available.toFixed(1)),
    unit: "%",
    status:
      available === null
        ? "unavailable"
        : available <= t.memoryAvailableCriticalPercent
          ? "critical"
          : available <= t.memoryAvailableWarnPercent
            ? "warning"
            : "ok",
    warning: t.memoryAvailableWarnPercent,
    critical: t.memoryAvailableCriticalPercent,
    detail: memory
      ? `${(memory.availableBytes / 1048576).toFixed(0)} MiB available of ${(memory.totalBytes / 1048576).toFixed(0)} MiB`
      : "Not reported",
  });
  const perCpu =
    host.load && host.cpuCount ? host.load[1] / host.cpuCount : null;
  metrics.push({
    key: "load_per_cpu",
    label: "Load average (5 min) per CPU",
    value: perCpu === null ? null : Number(perCpu.toFixed(2)),
    unit: "per CPU",
    status:
      perCpu === null
        ? "unavailable"
        : above(perCpu, t.loadPerCpuWarn, t.loadPerCpuCritical),
    warning: t.loadPerCpuWarn,
    critical: t.loadPerCpuCritical,
    detail: host.load
      ? `1/5/15 min: ${host.load.map((v) => v.toFixed(2)).join(" / ")} on ${host.cpuCount ?? "?"} CPU`
      : "Not reported",
  });
  return metrics;
}
function containerViews(report: ControllerReport) {
  if (!report.containers) return null;
  const services = new Map(report.containers.map((c) => [c.service, c]));
  return [
    ...EXPECTED_SERVICES.map((service) => {
      const c = services.get(service);
      const ok =
        !!c && c.state === "running" && (!c.health || c.health === "healthy");
      return {
        service,
        state: c?.state ?? "missing",
        health: c?.health ?? null,
        status: (ok
          ? "ok"
          : c?.state === "running" && c.health === "starting"
            ? "warning"
            : "critical") as Level,
      };
    }),
    ...report.containers
      .filter((c) => !EXPECTED_SERVICES.includes(c.service))
      .map((c) => ({
        service: c.service,
        state: c.state,
        health: c.health,
        // The migration job exits after each deployment; a failed exit is a problem.
        status: (c.service === "migrate" && c.state === "exited" && c.exitCode
          ? "warning"
          : "info") as Level,
      })),
  ];
}

export type HostHealth = {
  asOf: string;
  thresholds: { revision: number; values: HostThresholds; reason: string };
  controller: {
    state:
      | "measured"
      | "stale"
      | "unreported"
      | "unverified"
      | "invalid"
      | "signing_unavailable";
    reportedAt: string | null;
    ageSeconds: number | null;
    release: string | null;
  };
  metricsSource: "controller" | "api" | null;
  metrics: MetricView[];
  containers: ReturnType<typeof containerViews>;
  deploy: ControllerReport["deploy"] | null;
  edge: ControllerReport["edge"] | null;
  backups: BackupStatus;
  overall: Level;
};
/** Host metrics evaluated against the current thresholds (read-only). */
export async function readHostHealth(
  db: Database,
  options: { now?: number } = {},
): Promise<HostHealth> {
  const now = options.now ?? Date.now(),
    key = hostOperationsKey();
  return db.system(async (tx) => {
    const policy = await currentThresholds(tx);
    const rows = await statusRows(tx);
    const controller = readController(rows.controller, key, now);
    const t = policy.thresholds;
    // Freshness comes from the signed report time; the row's own timestamp is
    // only shown for reports that do not verify.
    const reportedAtMs =
      controller.reportedAtMs ??
      (rows.controller ? ms(rows.controller.reported_at) : null);
    const ageSeconds =
      reportedAtMs === null ? null : Math.max(0, (now - reportedAtMs) / 1000);
    const fresh = ageSeconds !== null && ageSeconds <= t.reportFreshnessSeconds;
    const state = !rows.controller
      ? "unreported"
      : !key
        ? "signing_unavailable"
        : controller.state === "invalid"
          ? "invalid"
          : controller.state === "unverified"
            ? "unverified"
            : fresh
              ? "measured"
              : "stale";
    let metrics: MetricView[] = [],
      metricsSource: HostHealth["metricsSource"] = null;
    if (state === "measured" && controller.report?.host) {
      metrics = hostMetrics(controller.report.host, t);
      metricsSource = "controller";
    } else if (rows.api) {
      try {
        const api = apiReport.parse(JSON.parse(rows.api.payload));
        const apiAge = (now - ms(rows.api.reported_at)) / 1000;
        if (apiAge <= t.reportFreshnessSeconds) {
          metrics = hostMetrics(
            {
              cpuCount: api.cpuCount,
              load: api.load,
              memory: api.memory,
              disks: api.disk ? [api.disk] : [],
            },
            t,
          );
          metricsSource = "api";
        }
      } catch {
        // An unreadable API sample is treated as absent.
      }
    }
    const containers =
      state === "measured" && controller.report
        ? containerViews(controller.report)
        : null;
    const backups = backupStatusFrom(controller, t, now);
    const levels: Level[] = [
      ...metrics.map((m) => m.status),
      ...(containers ?? []).map((c) => c.status),
      backups.state === "stale" || backups.state === "missing"
        ? "critical"
        : backups.state === "healthy"
          ? "ok"
          : "warning",
      state === "measured" ? "ok" : "warning",
    ];
    return {
      asOf: new Date(now).toISOString(),
      thresholds: {
        revision: policy.revision,
        values: t,
        reason: policy.reason,
      },
      controller: {
        state,
        reportedAt:
          reportedAtMs === null ? null : new Date(reportedAtMs).toISOString(),
        ageSeconds: ageSeconds === null ? null : Math.round(ageSeconds),
        release: controller.report?.controllerRelease ?? null,
      },
      metricsSource,
      metrics,
      containers,
      deploy: controller.report?.deploy ?? null,
      edge: controller.report?.edge ?? null,
      backups,
      overall: levels.includes("critical")
        ? "critical"
        : levels.includes("warning")
          ? "warning"
          : "ok",
    };
  });
}

/** Samples host-wide figures visible from the API container (Linux /proc). */
export async function sampleApiHost(): Promise<z.infer<typeof apiReport>> {
  let availableBytes = os.freemem();
  try {
    const match = /^MemAvailable:\s+(\d+) kB$/m.exec(
      await readFile("/proc/meminfo", "utf8"),
    );
    if (match) availableBytes = Number(match[1]) * 1024;
  } catch {
    // Non-Linux development hosts fall back to the process view.
  }
  let disk: z.infer<typeof apiReport>["disk"] = null;
  try {
    const s = await statfs("/");
    const total = Number(s.blocks) * Number(s.bsize),
      free = Number(s.bavail) * Number(s.bsize);
    disk = {
      mount: "/",
      totalBytes: total,
      freeBytes: free,
      usedBytes: Math.max(0, total - Number(s.bfree) * Number(s.bsize)),
    };
  } catch {
    disk = null;
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    cpuCount: Math.max(1, os.availableParallelism()),
    load: os.loadavg().map((v) => Number(v.toFixed(3))),
    memory: { totalBytes: os.totalmem(), availableBytes },
    disk,
  };
}
export async function recordApiHostSample(
  db: Database,
  sample?: z.infer<typeof apiReport>,
) {
  const payload = JSON.stringify(
    apiReport.parse(sample ?? (await sampleApiHost())),
  );
  await db.system((tx) =>
    tx.query(
      "INSERT INTO host_status(source,payload,signature,reported_at) VALUES('api',$1,NULL,now()) ON CONFLICT(source) DO UPDATE SET payload=EXCLUDED.payload,signature=NULL,reported_at=now()",
      [payload],
    ),
  );
}

// ---- On-demand TLS ask -----------------------------------------------------

/**
 * Hostnames the edge may obtain certificates for, loaded as one set. Every TLS
 * handshake for an unknown name makes Caddy ask, unauthenticated clients can
 * choose those names, so a lookup must never cost a query per name: a flood of
 * random names triggers at most one reload per ASK_MISS_RELOAD_MS.
 */
type AskSnapshot = {
  /** hostname -> permitted until (ms); Infinity for an active mapping. */
  hosts: Map<string, number>;
  loadedAt: number;
  loading: Promise<void> | null;
  /** Bumped by every new allowance; a set loaded before the bump is stale. */
  generation: number;
  loadedGeneration: number;
};
const askSnapshots = new WeakMap<Database, AskSnapshot>();
/** A permitted name is re-read at least this often (deactivation takes effect). */
const ASK_MAX_AGE_MS = 30000;
/** An unknown name reloads the set at most this often. */
const ASK_MISS_RELOAD_MS = 5000;
const ASK_HOST_LIMIT = 100000;
function askSnapshot(db: Database) {
  let snapshot = askSnapshots.get(db);
  if (!snapshot)
    askSnapshots.set(
      db,
      (snapshot = {
        hosts: new Map(),
        loadedAt: -Infinity,
        loading: null,
        generation: 0,
        loadedGeneration: -1,
      }),
    );
  return snapshot;
}
async function reloadAskHosts(
  db: Database,
  snapshot: AskSnapshot,
  now: number,
) {
  // Concurrent asks share one query. A load already in flight may have started
  // before the latest allowance; then one more load follows it.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (snapshot.loading) {
      await snapshot.loading;
      if (snapshot.loadedGeneration === snapshot.generation) return;
      continue;
    }
    const generation = snapshot.generation;
    snapshot.loading = (async () => {
      try {
        const rows = await db.system((tx) =>
          tx.query<{ hostname: string; expires_at: unknown }>(
            "SELECT m.hostname,NULL::timestamptz AS expires_at FROM domain_mappings m JOIN tenants t ON t.id=m.tenant_id WHERE m.active AND m.verified_at IS NOT NULL AND t.lifecycle_state='active' UNION ALL SELECT a.hostname,a.expires_at FROM tls_issuance_allowances a JOIN tenants t ON t.id=a.tenant_id WHERE a.expires_at>now() AND t.lifecycle_state='active' LIMIT " +
              ASK_HOST_LIMIT,
          ),
        );
        const hosts = new Map<string, number>();
        for (const row of rows) {
          const until = row.expires_at === null ? Infinity : ms(row.expires_at);
          hosts.set(
            row.hostname,
            Math.max(hosts.get(row.hostname) ?? -Infinity, until),
          );
        }
        snapshot.hosts = hosts;
        snapshot.loadedAt = now;
        snapshot.loadedGeneration = generation;
      } finally {
        snapshot.loading = null;
      }
    })();
    await snapshot.loading;
    return;
  }
}
function askAllowed(snapshot: AskSnapshot, host: string, now: number) {
  return (snapshot.hosts.get(host) ?? -Infinity) > now;
}
/** A lower-case DNS name without port or trailing dot; IP literals are refused. */
export function askHostname(value: string) {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    host.length < 3 ||
    host.length > 253 ||
    isIP(host) ||
    !host.includes(".") ||
    !host
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw fail(400, "INVALID_DOMAIN", "Invalid domain name.");
  return host;
}
function platformHostname() {
  try {
    return new URL(runtimeConfig().PUBLIC_APP_URL ?? "http://localhost:3000")
      .hostname;
  } catch {
    return null;
  }
}
/**
 * True for an active, verified coach-domain mapping of an active workspace, or
 * for an unexpired issuance allowance created by an operator's activation
 * attempt. The platform's own address has its own certificate and is refused.
 */
export async function tlsIssuancePermitted(
  db: Database,
  hostname: string,
  now = Date.now(),
) {
  const host = askHostname(hostname);
  if (host === platformHostname()) return false;
  const snapshot = askSnapshot(db),
    age = now - snapshot.loadedAt;
  // A clock that moved backwards counts as stale.
  if (
    age < 0 ||
    age > ASK_MAX_AGE_MS ||
    snapshot.loadedGeneration !== snapshot.generation
  )
    await reloadAskHosts(db, snapshot, now);
  else if (!askAllowed(snapshot, host, now) && age > ASK_MISS_RELOAD_MS)
    await reloadAskHosts(db, snapshot, now);
  return askAllowed(snapshot, host, now);
}
/**
 * Called by coach-domain activation just before its HTTPS check, so the edge
 * may obtain this one certificate. The allowance lasts fifteen minutes.
 */
export async function permitCertificateIssuance(
  db: Database,
  input: {
    hostname: string;
    tenantId: string;
    orderId: string;
    actorId: string;
  },
) {
  const host = askHostname(input.hostname);
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tls_issuance_allowances(hostname,tenant_id,domain_order_id,created_by,created_at,expires_at) VALUES($1,$2,$3,$4,now(),now()+interval '15 minutes') ON CONFLICT(hostname) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,domain_order_id=EXCLUDED.domain_order_id,created_by=EXCLUDED.created_by,created_at=now(),expires_at=now()+interval '15 minutes'",
      [host, input.tenantId, input.orderId, input.actorId],
    ),
  );
  // The next ask re-reads the set, so the new allowance applies at once.
  askSnapshot(db).generation++;
}

// ---- Platform address validation ------------------------------------------

type Resolver = {
  resolve4: (host: string) => Promise<string[]>;
  resolve6: (host: string) => Promise<string[]>;
};
async function addresses(resolver: Resolver, host: string) {
  const timeout = <T>(p: Promise<T>) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000).unref(),
      ),
    ]);
  const settle = async (p: Promise<string[]>) => {
    try {
      return await timeout(p);
    } catch {
      return [];
    }
  };
  const [v4, v6] = await Promise.all([
    settle(resolver.resolve4(host)),
    settle(resolver.resolve6(host)),
  ]);
  return [...v4, ...v6];
}
type Check = {
  key: string;
  ok: boolean;
  level: "error" | "warning" | "info";
  message: string;
};
export async function checkPlatformAddress(
  db: Database,
  value: string,
  // The local mock-provider sandbox answers from its loopback DNS double.
  resolver: Resolver = sandboxResolver() ?? { resolve4, resolve6 },
) {
  const checks: Check[] = [];
  let parsed: URL | null = null;
  try {
    parsed = new URL(value.trim());
  } catch {
    parsed = null;
  }
  const format =
    !!parsed &&
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (parsed.port === "" || parsed.port === "443") &&
    parsed.pathname === "/" &&
    !parsed.search &&
    !parsed.hash &&
    !value.trim().endsWith("/") &&
    (() => {
      try {
        askHostname(parsed!.hostname);
        return true;
      } catch {
        return false;
      }
    })();
  checks.push({
    key: "format",
    ok: format,
    level: "error",
    message: format
      ? "The address is an HTTPS origin with a DNS name and no path, query or port."
      : "Use an HTTPS origin such as https://app.example.com: a DNS name, no IP address, port, path, query or trailing slash.",
  });
  const current = (() => {
    try {
      return new URL(runtimeConfig().PUBLIC_APP_URL ?? "http://localhost:3000");
    } catch {
      return null;
    }
  })();
  if (!format || !parsed)
    return {
      valid: false,
      origin: null,
      current: current?.origin ?? null,
      checks,
    };
  const host = parsed.hostname.toLowerCase(),
    origin = "https://" + host;
  const same = current?.origin === origin;
  checks.push({
    key: "changed",
    ok: !same,
    level: "info",
    message: same
      ? "This is already the platform address."
      : `The platform address would change from ${current?.origin ?? "an unset value"} to ${origin}.`,
  });
  const mapped = await db.system((tx) =>
    tx.query(
      "SELECT 1 FROM domain_mappings WHERE hostname=$1 UNION ALL SELECT 1 FROM tls_issuance_allowances WHERE hostname=$1 AND expires_at>now()",
      [host],
    ),
  );
  checks.push({
    key: "coach_domain",
    ok: mapped.length === 0,
    level: "error",
    message: mapped.length
      ? "This name is connected to a coach website. Disconnect it before using it for the platform."
      : "The name is not connected to any coach website.",
  });
  const [next, existing] = await Promise.all([
    addresses(resolver, host),
    current && current.hostname !== "localhost"
      ? addresses(resolver, current.hostname)
      : Promise.resolve([]),
  ]);
  const shared = next.filter((ip) => existing.includes(ip));
  checks.push({
    key: "dns",
    ok: next.length > 0 && (existing.length === 0 || shared.length > 0),
    level: "error",
    message: !next.length
      ? `${host} has no A or AAAA record yet. Point it at this server before switching.`
      : existing.length && !shared.length
        ? `${host} resolves to ${next.join(", ")}, but the current address resolves to ${existing.join(", ")}. Point it at this server.`
        : `${host} resolves to ${next.join(", ")}${existing.length ? ", the same server as the current address" : ""}.`,
  });
  const [passkeys] = current
    ? await db.system((tx) =>
        tx.query(
          "SELECT count(*)::int AS n FROM auth_passkeys WHERE rp_id=$1",
          [current.hostname],
        ),
      )
    : [{ n: 0 }];
  const count = Number(passkeys?.n ?? 0);
  checks.push({
    key: "passkeys",
    ok: count === 0,
    level: "warning",
    message: count
      ? `${count} passkey${count === 1 ? " is" : "s are"} bound to ${current?.hostname}. WebAuthn ties a passkey to its relying-party name, so ${count === 1 ? "it" : "they"} will stop working after the move. Those people sign in with their password and authenticator code (or a recovery code) and add a new passkey.`
      : "No passkeys are registered for the current address.",
  });
  checks.push({
    key: "sessions",
    ok: true,
    level: "info",
    message:
      "Sign-in cookies belong to the old name; everyone signs in again at the new address. Email links already sent keep pointing to the old address.",
  });
  checks.push({
    key: "providers",
    ok: true,
    level: "info",
    message:
      "Update provider callbacks that name the platform address: the Stripe webhook endpoint, wearable OAuth redirect addresses and the DOMAIN_CNAME_TARGET that coach domains point to.",
  });
  return {
    valid: checks.every((c) => c.ok || c.level !== "error"),
    origin,
    current: current?.origin ?? null,
    checks,
  };
}

// ---- Routes ------------------------------------------------------------------

async function audit(
  tx: Tx,
  a: Identity,
  action: string,
  subject: string | null,
  data: unknown = {},
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), a.userId, action, subject, JSON.stringify(data)],
  );
}
function presentRequest(
  row: Record<string, any>,
  key: Buffer | null,
  now: number,
) {
  let result: unknown = null;
  if (row.result)
    try {
      result = JSON.parse(row.result);
    } catch {
      result = { message: "Unreadable result" };
    }
  const reported = ["succeeded", "failed", "rejected", "expired"].includes(
    row.status,
  );
  return {
    id: row.id,
    requestId: row.request_id,
    action: row.action,
    label: hostActions[row.action as HostAction]?.label ?? row.action,
    target: row.target,
    reason: row.reason,
    requestedBy: row.requested_by,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: new Date(Number(row.expires_at_ms)).toISOString(),
    pickedUpAt: row.picked_up_at,
    finishedAt: row.finished_at,
    result,
    resultVerified:
      reported && !!key && !!row.result
        ? sameHex(
            row.result_signature,
            signHostResult(key, row.id, row.status, row.result),
          )
        : null,
    notPickedUp: row.status === "pending" && Number(row.expires_at_ms) <= now,
    outcomeUnknown:
      row.status === "running" &&
      now - ms(row.picked_up_at) > RUNNING_UNKNOWN_MS,
  };
}

export function registerHostOperations(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
  options: { startSampler?: boolean; resolver?: Resolver } = {},
) {
  const access = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Host operations require platform administrator access.",
      );
    requireRecentMfa(a, true);
    return a;
  };
  async function currentAdmin(tx: Tx, a: Identity) {
    const [u] = await tx.query(
      "SELECT platform_role FROM users WHERE id=$1 FOR SHARE",
      [a.userId],
    );
    if (u?.platform_role !== "admin")
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Current administrator access required.",
      );
  }
  const reason = z.string().trim().min(10).max(500);

  let timer: ReturnType<typeof setInterval> | undefined;
  if (options.startSampler)
    app.addHook("onReady", async () => {
      const sample = () =>
        void recordApiHostSample(db).catch(() =>
          app.log.warn("Host sample could not be recorded"),
        );
      sample();
      timer = setInterval(sample, 5 * 60000);
      timer.unref();
    });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
  });

  app.get(
    TLS_ASK_PATH,
    {
      config: {
        // Every ask comes from the one edge container, so a shared per-address
        // budget would let a flood of random names deny real ones. Budget per
        // requested name instead; lookups themselves are served from memory.
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) =>
            "tls-ask:" +
            String((req.query as { domain?: unknown })?.domain ?? "")
              .trim()
              .toLowerCase()
              .replace(/\.$/, "")
              .slice(0, 260),
        },
      },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      // Only the edge calls this directly on the private network. Requests
      // relayed by the public web proxy always carry host provenance headers.
      if (
        req.hostContext?.verifiedProxy ||
        Object.values(HOST_HEADERS).some((name) => req.headers[name] != null)
      )
        return reply.code(404).send({ allowed: false });
      const expected = tlsAskToken();
      if (!expected)
        return reply.code(503).send({
          allowed: false,
          code: "TLS_ASK_UNAVAILABLE",
          message: "The internal signing secret is not configured.",
        });
      const query = z
        .object({
          domain: z.string().min(1).max(260),
          token: z.string().min(1).max(128),
        })
        .safeParse(req.query);
      if (!query.success)
        return reply.code(400).send({ allowed: false, code: "INVALID_ASK" });
      if (!sameHex(query.data.token, expected))
        return reply.code(403).send({ allowed: false, code: "ASK_TOKEN" });
      let host: string;
      try {
        host = askHostname(query.data.domain);
      } catch {
        return reply.code(400).send({ allowed: false, code: "INVALID_DOMAIN" });
      }
      const allowed = await tlsIssuancePermitted(db, host);
      return reply.code(allowed ? 200 : 404).send({ allowed });
    },
  );

  const prefix = "/api/v1/admin/infrastructure/host";
  app.get(prefix, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const a = access(req),
      key = hostOperationsKey(),
      now = Date.now();
    const health = await readHostHealth(db, { now });
    return db.system(async (tx) => {
      const requests = await tx.query(
        "SELECT * FROM host_action_requests ORDER BY created_at DESC LIMIT 50",
      );
      await audit(tx, a, "infrastructure.host.read", null);
      return {
        ...health,
        signingAvailable: !!key,
        actions: {
          allowlist: actionNames.map((name) => ({
            action: name,
            ...hostActions[name],
          })),
          ttlMinutes: HOST_ACTION_TTL_MS / 60000,
          perHour: ACTIONS_PER_HOUR,
          recent: requests.map((row) => presentRequest(row, key, now)),
          pickup:
            "The host controller checks for requests about every five minutes, after any deployment in progress.",
        },
        outOfScope: [
          {
            capability:
              "Resize the server, snapshots, volumes, firewalls, DNS or billing",
            reason:
              "These are DigitalOcean account operations and need a DigitalOcean API token on the server. The deployment deliberately keeps the management token off the host (it never enters cloud-init, images or runtime settings), so a compromised application cannot change or buy cloud resources. Use the DigitalOcean control panel.",
          },
          {
            capability:
              "Arbitrary commands, database restores into production, secret changes",
            reason:
              "Only the allowlisted actions above run. Production restores and runtime secret changes stay manual operator procedures (see docs/features/infra-ops.md).",
          },
        ],
      };
    });
  });

  app.post(prefix + "/thresholds", async (req) => {
    const a = access(req),
      b = z
        .object({
          revision: z.number().int().positive(),
          thresholds: hostThresholds,
          reason,
        })
        .strict()
        .parse(req.body);
    return db.system(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtext('host-monitor-policy'))",
      );
      await currentAdmin(tx, a);
      const current = await currentThresholds(tx);
      if (current.revision !== b.revision)
        throw fail(
          409,
          "STALE_POLICY",
          "The host thresholds changed. Reload before saving.",
        );
      const [row] = await tx.query(
        "INSERT INTO host_monitor_policies(revision,thresholds,reason,created_by) VALUES($1,$2,$3,$4) RETURNING revision,thresholds,reason,created_at",
        [
          current.revision + 1,
          JSON.stringify(b.thresholds),
          b.reason,
          a.userId,
        ],
      );
      await audit(
        tx,
        a,
        "infrastructure.host.thresholds",
        String(row.revision),
        {
          thresholds: b.thresholds,
          reason: b.reason,
        },
      );
      return row;
    });
  });

  app.post(prefix + "/actions", async (req) => {
    const a = access(req),
      b = z
        .object({
          requestId: z.string().uuid(),
          action: z.enum(actionNames),
          target: z.enum(["api", "web", "worker"]).nullable().optional(),
          reason,
        })
        .strict()
        .parse(req.body);
    const target = b.target ?? null;
    if ((b.action === "restart_service") !== (target !== null))
      throw fail(
        400,
        "HOST_ACTION_TARGET",
        b.action === "restart_service"
          ? "Choose the service to restart."
          : "This action does not take a service.",
      );
    const key = hostOperationsKey();
    if (!key)
      throw fail(
        503,
        "HOST_SIGNING_UNAVAILABLE",
        "Host actions need the internal signing secret on this server.",
      );
    return db.system(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('host-actions'))");
      await currentAdmin(tx, a);
      const [prior] = await tx.query(
        "SELECT * FROM host_action_requests WHERE request_id=$1",
        [b.requestId],
      );
      if (prior) {
        if (
          prior.requested_by !== a.userId ||
          prior.action !== b.action ||
          (prior.target ?? null) !== target ||
          prior.reason !== b.reason
        )
          throw fail(
            409,
            "INTENT_CONFLICT",
            "This request identifier was already used for a different action.",
          );
        return presentRequest(prior, key, Date.now());
      }
      const [open] = await tx.query(
        "SELECT id FROM host_action_requests WHERE action=$1 AND coalesce(target,'-')=$2 AND status IN ('pending','running')",
        [b.action, target ?? "-"],
      );
      if (open)
        throw fail(
          409,
          "HOST_ACTION_OPEN",
          "The same action is already waiting for the host controller.",
        );
      const [recent] = await tx.query(
        "SELECT count(*)::int AS n FROM host_action_requests WHERE created_at>now()-interval '1 hour'",
      );
      if (Number(recent.n) >= ACTIONS_PER_HOUR)
        throw fail(
          429,
          "HOST_ACTION_RATE",
          "The hourly limit for host actions is reached. Try again later.",
        );
      const issuedAtMs = Date.now();
      const intent: HostActionIntent = {
        id: randomUUID(),
        requestId: b.requestId,
        action: b.action,
        target,
        requestedBy: a.userId,
        issuedAtMs,
        expiresAtMs: issuedAtMs + HOST_ACTION_TTL_MS,
        reason: b.reason,
      };
      const [row] = await tx.query(
        "INSERT INTO host_action_requests(id,request_id,action,target,reason,requested_by,issued_at_ms,expires_at_ms,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          intent.id,
          intent.requestId,
          intent.action,
          intent.target,
          intent.reason,
          intent.requestedBy,
          intent.issuedAtMs,
          intent.expiresAtMs,
          signHostAction(intent, key),
        ],
      );
      await audit(tx, a, "infrastructure.host_action.requested", intent.id, {
        action: intent.action,
        target: intent.target,
        reason: intent.reason,
      });
      return presentRequest(row, key, Date.now());
    });
  });

  app.post(prefix + "/actions/:id/cancel", async (req) => {
    const a = access(req),
      id = z
        .string()
        .uuid()
        .parse((req.params as { id?: string }).id),
      b = z.object({ reason }).strict().parse(req.body);
    return db.system(async (tx) => {
      await currentAdmin(tx, a);
      const [row] = await tx.query(
        "SELECT * FROM host_action_requests WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!row) throw fail(404, "HOST_ACTION_NOT_FOUND", "Request not found.");
      if (row.status === "canceled")
        return presentRequest(row, hostOperationsKey(), Date.now());
      if (row.status !== "pending")
        throw fail(
          409,
          "HOST_ACTION_STATE",
          "Only a request the controller has not started can be canceled.",
        );
      const [updated] = await tx.query(
        "UPDATE host_action_requests SET status='canceled',finished_at=now(),result=$2 WHERE id=$1 AND status='pending' RETURNING *",
        [
          id,
          JSON.stringify({ message: "Canceled by an operator before pickup." }),
        ],
      );
      await audit(tx, a, "infrastructure.host_action.canceled", id, {
        reason: b.reason,
      });
      return presentRequest(updated, hostOperationsKey(), Date.now());
    });
  });

  app.post(
    "/api/v1/admin/infrastructure/platform-address/check",
    async (req) => {
      const a = access(req),
        b = z
          .object({ url: z.string().min(8).max(300) })
          .strict()
          .parse(req.body);
      const result = await checkPlatformAddress(db, b.url, options.resolver);
      await db.system((tx) =>
        audit(tx, a, "infrastructure.platform_address.checked", null, {
          origin: result.origin,
          valid: result.valid,
        }),
      );
      return {
        ...result,
        procedure: [
          "Create an A (and AAAA, if used) record for the new name pointing at this server, and wait until this check passes.",
          "Tell people with passkeys that they will sign in with password and authenticator once and add a new passkey.",
          "In the DigitalOcean console, edit PUBLIC_APP_URL in /opt/gymmembership/runtime.env (keep mode 600 and every other value unchanged).",
          "Request 'Re-apply runtime settings' here. The controller renders the edge for the new name, recreates the services and checks readiness at the new address. If that check fails, nothing is rolled back: the edge stays on the new name and the platform may be unreachable at both names. Then restore the old PUBLIC_APP_URL in runtime.env from the DigitalOcean console and, as root, run python3 /opt/gymmembership/releases/<serving release>/infra/digitalocean/hostops.py reapply (or request re-apply here again if this page still loads).",
          "Update the Stripe webhook endpoint, wearable OAuth redirect addresses and DOMAIN_CNAME_TARGET, then re-run the live checks.",
        ],
      };
    },
  );
}
