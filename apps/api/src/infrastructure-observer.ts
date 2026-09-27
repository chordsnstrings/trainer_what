import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { z } from "zod";
import { requireRecentMfa } from "./security.ts";

type Identity = Actor & { platformRole: string; mfaAt?: string | null };
type Service = "api" | "worker";
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const conflict = () =>
  fail(
    409,
    "INFRASTRUCTURE_REVISION_CONFLICT",
    "This observation or policy changed. Reload before continuing.",
  );
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lock = (tx: Tx) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtext('infrastructure-observer'))");

export const infrastructureThresholds = z
  .object({
    freshnessSeconds: z.number().int().min(60).max(3600),
    minimumRequests: z.number().int().min(1).max(1000),
    apiP95Ms: z.number().min(1).max(60000),
    apiErrorPercent: z.number().min(0).max(100),
    processRssMb: z.number().min(16).max(131072),
    processCpuPercent: z.number().min(1).max(6400),
    databaseProbeMs: z.number().min(1).max(30000),
    databaseConnectionPercent: z.number().min(1).max(100),
    queueReadyCount: z.number().int().min(0).max(1000000),
    queueOldestReadySeconds: z.number().int().min(1).max(604800),
    queueFailedCount: z.number().int().min(0).max(1000000),
    workerFailedCycles: z.number().int().min(0).max(1000000),
  })
  .strict();
type Thresholds = z.infer<typeof infrastructureThresholds>;
type MetricDefinition = {
  label: string;
  unit: string;
  source: "both" | Service;
  explanation: string;
};
export const infrastructureMetrics = {
  process_cpu_percent: {
    label: "Process CPU",
    unit: "% of one core",
    source: "both",
    explanation:
      "CPU time used by this reporting process during the observation interval; can exceed 100%.",
  },
  process_rss_mb: {
    label: "Process resident memory",
    unit: "MiB",
    source: "both",
    explanation:
      "Resident memory of this reporting process, not total machine memory.",
  },
  process_heap_mb: {
    label: "JavaScript heap used",
    unit: "MiB",
    source: "both",
    explanation: "Current process heap usage.",
  },
  process_uptime_seconds: {
    label: "Process uptime",
    unit: "seconds",
    source: "both",
    explanation: "Uptime of this reporting process.",
  },
  api_requests: {
    label: "Completed API requests",
    unit: "requests",
    source: "api",
    explanation:
      "All requests completed in this process during the interval, without URLs, identities or payloads.",
  },
  api_request_samples: {
    label: "Retained latency samples",
    unit: "requests",
    source: "api",
    explanation:
      "At most the last 2,048 completed requests in the interval; percentiles describe this sample.",
  },
  api_errors: {
    label: "Server errors",
    unit: "responses",
    source: "api",
    explanation:
      "Completed responses with status 500 or above; client errors are excluded.",
  },
  api_error_percent: {
    label: "API server error rate",
    unit: "%",
    source: "api",
    explanation:
      "Server errors divided by all completed requests in this interval.",
  },
  api_p50_ms: {
    label: "API sampled p50",
    unit: "ms",
    source: "api",
    explanation:
      "Nearest-rank percentile of retained completed-request latency samples.",
  },
  api_p95_ms: {
    label: "API sampled p95",
    unit: "ms",
    source: "api",
    explanation:
      "Nearest-rank percentile of retained completed-request latency samples.",
  },
  api_p99_ms: {
    label: "API sampled p99",
    unit: "ms",
    source: "api",
    explanation:
      "Nearest-rank percentile of retained completed-request latency samples.",
  },
  worker_cycles: {
    label: "Completed worker iterations",
    unit: "iterations",
    source: "worker",
    explanation:
      "Top-level worker iterations reported by the loop; handled job failures appear separately in queue measurements.",
  },
  worker_failed_cycles: {
    label: "Failed worker iterations",
    unit: "iterations",
    source: "worker",
    explanation: "Top-level loop failures in this reporting interval.",
  },
  worker_last_cycle_ms: {
    label: "Last worker iteration",
    unit: "ms",
    source: "worker",
    explanation: "Elapsed time of the last reported worker iteration.",
  },
  database_probe_ms: {
    label: "Database round trip",
    unit: "ms",
    source: "api",
    explanation:
      "A SELECT 1 transaction including connection acquisition, measured from the API process.",
  },
  database_connections: {
    label: "PostgreSQL client connections",
    unit: "connections",
    source: "api",
    explanation:
      "Client backends reported by pg_stat_activity, without query text or identities.",
  },
  database_connection_max: {
    label: "PostgreSQL connection maximum",
    unit: "connections",
    source: "api",
    explanation:
      "Server max_connections, including reserved capacity; not a provider account quota.",
  },
  database_connection_percent: {
    label: "PostgreSQL connections used",
    unit: "%",
    source: "api",
    explanation: "Reported client backends divided by server max_connections.",
  },
  queue_ready_count: {
    label: "Ready unleased jobs",
    unit: "jobs",
    source: "api",
    explanation:
      "Pending jobs due now without an active lease in the observed active workspaces.",
  },
  queue_pending_count: {
    label: "All pending jobs",
    unit: "jobs",
    source: "api",
    explanation: "Includes future scheduled and currently leased jobs.",
  },
  queue_leased_count: {
    label: "Currently leased jobs",
    unit: "jobs",
    source: "api",
    explanation: "Pending jobs whose lease has not expired.",
  },
  queue_oldest_ready_seconds: {
    label: "Oldest ready job wait",
    unit: "seconds",
    source: "api",
    explanation:
      "Age since available_at for the oldest due, unleased pending job; future work is excluded.",
  },
  queue_failed_count: {
    label: "Blocked or failed jobs",
    unit: "jobs",
    source: "api",
    explanation:
      "Current blocked and failed jobs across observed active workspaces; no error text or payloads collected.",
  },
  queue_tenants_observed: {
    label: "Workspaces observed",
    unit: "workspaces",
    source: "api",
    explanation:
      "Up to 100 active workspaces per queue observation; larger installations show partial coverage.",
  },
  queue_tenants_total: {
    label: "Active workspace count",
    unit: "workspaces",
    source: "api",
    explanation: "Active workspaces counted when the observation began.",
  },
} as const satisfies Record<string, MetricDefinition>;
type Metric = keyof typeof infrastructureMetrics;
const metricNames = Object.keys(infrastructureMetrics) as [Metric, ...Metric[]];
const measurementSchema = z
  .object({
    state: z.enum(["measured", "partial", "unavailable"]),
    value: z.number().finite().min(0).nullable(),
    reason: z
      .enum([
        "no_samples",
        "query_failed",
        "embedded_database",
        "partial_coverage",
      ])
      .optional(),
  })
  .strict()
  .refine(
    (v) => (v.state === "unavailable" ? v.value === null : v.value !== null),
    "Unavailable measurements must not contain a value",
  );
type Measurement = z.infer<typeof measurementSchema>;
type Measurements = Partial<Record<Metric, Measurement>>;
const observationSchema = z
  .object({
    service: z.enum(["api", "worker"]),
    collectorId: z.string().uuid(),
    sequence: z.number().int().positive(),
    windowStartedAt: z.iso.datetime(),
    windowEndedAt: z.iso.datetime(),
    measurements: z.partialRecord(z.enum(metricNames), measurementSchema),
  })
  .strict()
  .refine(
    (v) => Date.parse(v.windowStartedAt) <= Date.parse(v.windowEndedAt),
    "Observation window is invalid",
  )
  .refine(
    (v) =>
      Object.keys(v.measurements).every(
        (k) =>
          infrastructureMetrics[k as Metric].source === "both" ||
          infrastructureMetrics[k as Metric].source === v.service,
      ),
    "Measurement source is invalid",
  );
export type InfrastructureObservationInput = z.infer<typeof observationSchema>;
type Observation = {
  id: string;
  service: Service;
  collector_id: string;
  sequence: number;
  window_started_at: string;
  window_ended_at: string;
  recorded_at: string;
  measurements: Measurements;
  content_hash: string;
};
type Policy = {
  revision: number;
  mode: "observe_only";
  thresholds: Thresholds;
  reason_code: string;
  created_at: string;
  created_by: string | null;
};
const rules: Record<
  string,
  {
    metric?: Metric;
    threshold: keyof Thresholds;
    title: string;
    recommendation: string;
  }
> = {
  stale: {
    threshold: "freshnessSeconds",
    title: "Reporting evidence is stale",
    recommendation:
      "Check the reporting process and its database connectivity. A previous heartbeat does not establish current availability.",
  },
  api_p95_ms: {
    metric: "api_p95_ms",
    threshold: "apiP95Ms",
    title: "API latency exceeds the configured limit",
    recommendation:
      "Review the affected release and request timing with the on-call operator before deciding on capacity or rollback.",
  },
  api_error_percent: {
    metric: "api_error_percent",
    threshold: "apiErrorPercent",
    title: "API server errors exceed the configured limit",
    recommendation:
      "Review application error monitoring and release health with the on-call operator.",
  },
  process_rss_mb: {
    metric: "process_rss_mb",
    threshold: "processRssMb",
    title: "Process memory exceeds the configured limit",
    recommendation:
      "Review memory trends and workload size before approving a capacity change.",
  },
  process_cpu_percent: {
    metric: "process_cpu_percent",
    threshold: "processCpuPercent",
    title: "Process CPU exceeds the configured limit",
    recommendation:
      "Review sustained CPU use and workload duration before approving a concurrency or capacity change.",
  },
  database_probe_ms: {
    metric: "database_probe_ms",
    threshold: "databaseProbeMs",
    title: "Database round trip exceeds the configured limit",
    recommendation:
      "Investigate connection acquisition and query responsiveness with an authorized database operator.",
  },
  database_connection_percent: {
    metric: "database_connection_percent",
    threshold: "databaseConnectionPercent",
    title: "Database connection use exceeds the configured limit",
    recommendation:
      "Review connection pool use and reserved capacity before approving any database change.",
  },
  queue_ready_count: {
    metric: "queue_ready_count",
    threshold: "queueReadyCount",
    title: "Ready queue exceeds the configured limit",
    recommendation:
      "Review worker health and job throughput before approving a capacity or schedule change.",
  },
  queue_oldest_ready_seconds: {
    metric: "queue_oldest_ready_seconds",
    threshold: "queueOldestReadySeconds",
    title: "Ready jobs are waiting longer than configured",
    recommendation:
      "Inspect job operations for expired leases or stalled handlers using the existing authorized job views.",
  },
  queue_failed_count: {
    metric: "queue_failed_count",
    threshold: "queueFailedCount",
    title: "Blocked or failed jobs need review",
    recommendation:
      "Review job operations and reconcile unknown external outcomes before any retry.",
  },
  worker_failed_cycles: {
    metric: "worker_failed_cycles",
    threshold: "workerFailedCycles",
    title: "Worker iterations are failing",
    recommendation:
      "Review worker health and its recorded application errors with the on-call operator.",
  },
};
const unavailableSources = [
  {
    source: "Fleet and cloud resources",
    reason:
      "No cloud inventory or machine monitoring is connected. Host CPU/memory, pods and worker capacity are unavailable.",
  },
  {
    source: "Storage and egress",
    reason: "No storage-capacity or network-egress measurements are connected.",
  },
  {
    source: "Infrastructure spend and forecast",
    reason:
      "No cloud billing measurements are connected. No current or projected spend is estimated.",
  },
  {
    source: "AI provider performance and training backlog",
    reason:
      "This observer has no qualified provider-latency or training-backlog telemetry. Recorded AI usage remains in the separate FinOps view.",
  },
  {
    source: "Revenue and gross margin",
    reason:
      "This observer does not combine incomplete cloud costs with revenue to manufacture a margin estimate. Financial records remain in Finance.",
  },
];

async function currentPolicy(tx: Tx): Promise<Policy> {
  const [row] = await tx.query<Policy>(
    "SELECT * FROM infrastructure_policies ORDER BY revision DESC LIMIT 1",
  );
  return { ...row, thresholds: infrastructureThresholds.parse(row.thresholds) };
}
async function latestObservations(tx: Tx) {
  return tx.query<Observation>(
    "SELECT DISTINCT ON(service) * FROM infrastructure_observations ORDER BY service,window_ended_at DESC,recorded_at DESC,id DESC",
  );
}
function ageSeconds(o: Observation, now: number) {
  return Math.max(0, (now - Date.parse(String(o.window_ended_at))) / 1000);
}
function ruleValue(
  rule: string,
  o: Observation,
  policy: Policy,
  now: number,
): number | null {
  if (rule === "stale") return ageSeconds(o, now);
  if (ageSeconds(o, now) > policy.thresholds.freshnessSeconds) return null;
  const def = rules[rule];
  if (!def?.metric) return null;
  const m = o.measurements[def.metric];
  if (m?.state !== "measured") return null;
  if (
    (rule === "api_p95_ms" || rule === "api_error_percent") &&
    (o.measurements.api_requests?.value ?? 0) <
      policy.thresholds.minimumRequests
  )
    return null;
  return m.value;
}
async function evaluate(
  tx: Tx,
  policy: Policy,
  observations: Observation[],
  now: number,
) {
  for (const o of observations)
    for (const [rule, def] of Object.entries(rules)) {
      const value = ruleValue(rule, o, policy, now);
      const [active] = await tx.query(
        "SELECT * FROM infrastructure_recommendations WHERE service=$1 AND rule=$2 AND status<>'resolved' FOR UPDATE",
        [o.service, rule],
      );
      if (value === null) {
        // Missing, stale or partially observed metrics can never prove recovery.
        if (active?.recovery_observation_id)
          await tx.query(
            "UPDATE infrastructure_recommendations SET recovery_observation_id=NULL,revision=revision+1,updated_at=now() WHERE id=$1",
            [active.id],
          );
        continue;
      }
      const threshold = policy.thresholds[def.threshold],
        breach = value > threshold;
      if (!active && breach)
        await tx.query(
          "INSERT INTO infrastructure_recommendations(id,service,rule,first_observation_id,latest_observation_id,policy_revision,measured_value,threshold_value) VALUES($1,$2,$3,$4,$4,$5,$6,$7)",
          [
            randomUUID(),
            o.service,
            rule,
            o.id,
            policy.revision,
            value,
            threshold,
          ],
        );
      else if (active) {
        const recovery = breach ? null : o.id;
        // Staleness grows with time; only cross-boundary or evidence/policy changes
        // revise a case, so operators can act without a moving revision on each read.
        if (
          active.latest_observation_id !== o.id ||
          active.policy_revision !== policy.revision ||
          active.recovery_observation_id !== recovery
        ) {
          await tx.query(
            "UPDATE infrastructure_recommendations SET latest_observation_id=$2,recovery_observation_id=$3,policy_revision=$4,measured_value=$5,threshold_value=$6,revision=revision+1,updated_at=now() WHERE id=$1",
            [active.id, o.id, recovery, policy.revision, value, threshold],
          );
        }
      }
    }
}

/** Server-only ingestion. There is deliberately no HTTP measurement upload route. */
export async function persistInfrastructureObservation(
  db: Database,
  input: InfrastructureObservationInput,
) {
  const b = observationSchema.parse(input);
  const fingerprint = hash([
    b.service,
    b.collectorId,
    b.sequence,
    b.windowStartedAt,
    b.windowEndedAt,
    metricNames
      .filter((k) => b.measurements[k])
      .map((k) => [k, b.measurements[k]]),
  ]);
  return db.system(async (tx) => {
    await lock(tx);
    let [row] = await tx.query<Observation>(
      "INSERT INTO infrastructure_observations(id,service,collector_id,sequence,window_started_at,window_ended_at,measurements,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(collector_id,sequence) DO NOTHING RETURNING *",
      [
        randomUUID(),
        b.service,
        b.collectorId,
        b.sequence,
        b.windowStartedAt,
        b.windowEndedAt,
        JSON.stringify(b.measurements),
        fingerprint,
      ],
    );
    if (!row) {
      [row] = await tx.query<Observation>(
        "SELECT * FROM infrastructure_observations WHERE collector_id=$1 AND sequence=$2",
        [b.collectorId, b.sequence],
      );
      if (row.content_hash !== fingerprint)
        throw fail(
          409,
          "OBSERVATION_KEY_REUSED",
          "This observation key already identifies different measurements.",
        );
    }
    await evaluate(
      tx,
      await currentPolicy(tx),
      await latestObservations(tx),
      Date.now(),
    );
    return row;
  });
}

const measured = (value: number): Measurement => ({
  state: "measured",
  value: Math.max(0, Number(value.toFixed(3))),
});
const unavailable = (reason: Measurement["reason"]): Measurement => ({
  state: "unavailable",
  value: null,
  reason,
});
async function databaseMeasurements(
  db: Database,
  postgres: boolean,
): Promise<Measurements> {
  const result: Measurements = {},
    start = performance.now();
  try {
    await db.system((tx) => tx.query("SELECT 1 AS observer_probe"));
    result.database_probe_ms = measured(performance.now() - start);
  } catch {
    result.database_probe_ms = unavailable("query_failed");
  }
  const connectionMetrics: Metric[] = [
    "database_connections",
    "database_connection_max",
    "database_connection_percent",
  ];
  if (!postgres)
    for (const k of connectionMetrics)
      result[k] = unavailable("embedded_database");
  else
    try {
      const [row] = await db.system((tx) =>
        tx.query(
          "SELECT count(*)::int AS used,current_setting('max_connections')::int AS maximum FROM pg_stat_activity WHERE backend_type='client backend'",
        ),
      );
      if (!(Number(row.maximum) > 0)) throw new Error("Unavailable maximum");
      result.database_connections = measured(Number(row.used));
      result.database_connection_max = measured(Number(row.maximum));
      result.database_connection_percent = measured(
        (100 * Number(row.used)) / Number(row.maximum),
      );
    } catch {
      for (const k of connectionMetrics)
        result[k] = unavailable("query_failed");
    }
  const queueMetrics: Metric[] = [
    "queue_ready_count",
    "queue_pending_count",
    "queue_leased_count",
    "queue_oldest_ready_seconds",
    "queue_failed_count",
    "queue_tenants_observed",
    "queue_tenants_total",
  ];
  try {
    const { tenants, total } = await db.system(async (tx) => ({
      tenants: await tx.query(
        "SELECT id FROM tenants WHERE lifecycle_state='active' ORDER BY id LIMIT 100",
      ),
      total: Number(
        (
          await tx.query(
            "SELECT count(*)::int AS n FROM tenants WHERE lifecycle_state='active'",
          )
        )[0].n,
      ),
    }));
    let ready = 0,
      pending = 0,
      leased = 0,
      oldest = 0,
      failed = 0;
    for (const tenant of tenants) {
      const [q] = await db.tenant(
        {
          tenantId: tenant.id,
          userId: "00000000-0000-0000-0000-000000000000",
          role: "staff",
        },
        (tx) =>
          tx.query(
            "SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='pending' AND leased_until>now())::int AS leased,count(*) FILTER(WHERE status='pending' AND available_at<=now() AND (leased_until IS NULL OR leased_until<=now()))::int AS ready,coalesce(max(extract(epoch FROM(now()-available_at))) FILTER(WHERE status='pending' AND available_at<=now() AND (leased_until IS NULL OR leased_until<=now())),0)::float8 AS oldest,count(*) FILTER(WHERE status IN ('blocked','failed'))::int AS failed FROM jobs",
          ),
      );
      ready += Number(q.ready);
      pending += Number(q.pending);
      leased += Number(q.leased);
      oldest = Math.max(oldest, Number(q.oldest));
      failed += Number(q.failed);
    }
    const values = [
      ready,
      pending,
      leased,
      oldest,
      failed,
      tenants.length,
      total,
    ];
    queueMetrics.forEach(
      (k, i) =>
        (result[k] =
          total > tenants.length
            ? {
                ...measured(values[i]),
                state: "partial",
                reason: "partial_coverage",
              }
            : measured(values[i])),
    );
  } catch {
    for (const k of queueMetrics) result[k] = unavailable("query_failed");
  }
  return result;
}

/** One local process reporter; no cloud/network/provider adapter or executor. */
export function createInfrastructureObserver(
  db: Database,
  service: Service,
  options: { postgres?: boolean } = {},
) {
  const collectorId = randomUUID();
  let sequence = 0,
    startedAt = new Date().toISOString(),
    startedMono = performance.now(),
    cpu = process.cpuUsage();
  let requests = 0,
    errors = 0,
    samples: number[] = [],
    sampleIndex = 0,
    cycles = 0,
    failedCycles = 0,
    lastCycle: number | null = null;
  let inFlight: Promise<Observation> | undefined,
    pending: InfrastructureObservationInput | undefined;
  let lastAttempt = 0;
  const recordRequest = (durationMs: number, statusCode: number) => {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    requests++;
    if (statusCode >= 500) errors++;
    if (samples.length < 2048) samples.push(durationMs);
    else samples[sampleIndex++ % 2048] = durationMs;
  };
  const recordCycle = (durationMs: number, successful: boolean) => {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    cycles++;
    if (!successful) failedCycles++;
    lastCycle = durationMs;
  };
  const capture = (): Promise<Observation> => {
    if (inFlight) return inFlight;
    lastAttempt = Date.now();
    inFlight = (async () => {
      if (!pending) {
        const database =
          service === "api"
            ? await databaseMeasurements(
                db,
                options.postgres ?? Boolean(process.env.DATABASE_URL),
              )
            : {};
        const end = new Date().toISOString(),
          mono = performance.now(),
          nextCpu = process.cpuUsage(),
          memory = process.memoryUsage();
        const measurements: Measurements = {
          ...database,
          process_cpu_percent: measured(
            (100 * (nextCpu.user - cpu.user + nextCpu.system - cpu.system)) /
              1000 /
              Math.max(1, mono - startedMono),
          ),
          process_rss_mb: measured(memory.rss / 1048576),
          process_heap_mb: measured(memory.heapUsed / 1048576),
          process_uptime_seconds: measured(process.uptime()),
        };
        if (service === "api") {
          const sorted = [...samples].sort((a, b) => a - b);
          measurements.api_requests = measured(requests);
          measurements.api_errors = measured(errors);
          measurements.api_request_samples = measured(sorted.length);
          measurements.api_error_percent = requests
            ? measured((100 * errors) / requests)
            : unavailable("no_samples");
          for (const [key, percentile] of [
            ["api_p50_ms", 0.5],
            ["api_p95_ms", 0.95],
            ["api_p99_ms", 0.99],
          ] as const)
            measurements[key] = sorted.length
              ? measured(sorted[Math.ceil(sorted.length * percentile) - 1])
              : unavailable("no_samples");
        } else {
          measurements.worker_cycles = measured(cycles);
          measurements.worker_failed_cycles = measured(failedCycles);
          measurements.worker_last_cycle_ms =
            lastCycle === null
              ? unavailable("no_samples")
              : measured(lastCycle);
        }
        pending = {
          service,
          collectorId,
          sequence: ++sequence,
          windowStartedAt: startedAt,
          windowEndedAt: end,
          measurements,
        };
        // Requests arriving while persistence is awaited belong to the next interval.
        startedAt = end;
        startedMono = mono;
        cpu = nextCpu;
        requests = 0;
        errors = 0;
        samples = [];
        sampleIndex = 0;
        cycles = 0;
        failedCycles = 0;
        lastCycle = null;
      }
      const row = await persistInfrastructureObservation(db, pending);
      pending = undefined;
      return row;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  return {
    recordRequest,
    recordCycle,
    capture,
    collectIfDue: () =>
      Date.now() - lastAttempt >= 60000 ? capture() : Promise.resolve(null),
    settled: () => inFlight ?? Promise.resolve(null),
  };
}

function presentRecommendation(r: Record<string, any>) {
  return {
    ...r,
    title: rules[r.rule].title,
    recommendation: rules[r.rule].recommendation,
    canResolve: !!r.recovery_observation_id,
    evidencePath: `/api/v1/admin/infrastructure/observations/${r.latest_observation_id}`,
  };
}
async function audit(
  tx: Tx,
  a: Identity,
  action: string,
  subject: string | null,
  data: unknown = {},
  id: string = randomUUID(),
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
    [id, a.userId, action, subject, JSON.stringify(data)],
  );
}
async function mutation(
  db: Database,
  a: Identity,
  requestId: string,
  action: string,
  body: unknown,
  fn: (tx: Tx) => Promise<any>,
) {
  const fingerprint = hash(body);
  return db.system(async (tx) => {
    await lock(tx);
    const [prior] = await tx.query(
      "SELECT actor_id,action,data FROM admin_operations_audit WHERE id=$1",
      [requestId],
    );
    if (prior) {
      if (
        prior.actor_id !== a.userId ||
        prior.action !== action ||
        prior.data.fingerprint !== fingerprint
      )
        throw fail(
          409,
          "INFRASTRUCTURE_REQUEST_REUSED",
          "This request identifier was already used for another change.",
        );
      return prior.data.result;
    }
    const result = await fn(tx);
    await audit(
      tx,
      a,
      action,
      result.id ?? null,
      { fingerprint, result },
      requestId,
    );
    return result;
  });
}

export function registerInfrastructureObserver(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
  options: { startCollector?: boolean; postgres?: boolean } = {},
) {
  const reporter = createInfrastructureObserver(db, "api", options),
    starts = new WeakMap<FastifyRequest, number>();
  const access = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Infrastructure observations require platform administrator access.",
      );
    requireRecentMfa(a, true);
    const at = Date.parse(a.mfaAt ?? "");
    if (!Number.isFinite(at) || at > Date.now() + 5000)
      throw fail(
        403,
        "MFA_STEP_UP",
        "Verify your authenticator in Account security before this action.",
      );
    return a;
  };
  app.addHook("onRequest", async (req) => {
    starts.set(req, performance.now());
  });
  app.addHook("onResponse", async (req, reply) => {
    const start = starts.get(req);
    if (start !== undefined)
      reporter.recordRequest(performance.now() - start, reply.statusCode);
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  if (options.startCollector !== false)
    app.addHook("onReady", async () => {
      const sample = () => {
        void reporter
          .collectIfDue()
          .catch(() =>
            app.log.warn("Infrastructure observations could not be persisted"),
          );
      };
      sample();
      timer = setInterval(sample, 60000);
      timer.unref();
    });
  app.addHook("preClose", async () => {
    if (timer) clearInterval(timer);
    await reporter.settled().catch(() => {});
  });
  app.get("/api/v1/admin/infrastructure", async (req) => {
    const a = access(req);
    return db.system(async (tx) => {
      await lock(tx);
      const policy = await currentPolicy(tx),
        observations = await latestObservations(tx),
        now = Date.now();
      await evaluate(tx, policy, observations, now);
      const recommendations = await tx.query(
        "SELECT * FROM infrastructure_recommendations ORDER BY (status='resolved'),updated_at DESC LIMIT 100",
      );
      await audit(tx, a, "infrastructure.read", null);
      return {
        mode: "observe_only",
        executionEnabled: false,
        asOf: new Date(now).toISOString(),
        policy,
        metricDefinitions: infrastructureMetrics,
        unavailableSources,
        coverage:
          "Most recent reporting process per service. This is not a fleet inventory or an uptime guarantee. Queue scans cover at most 100 active workspaces; partial coverage cannot prove recovery.",
        services: (["api", "worker"] as const).map((service) => {
          const o = observations.find((x) => x.service === service);
          return {
            service,
            state: !o
              ? "unavailable"
              : ageSeconds(o, now) > policy.thresholds.freshnessSeconds
                ? "stale"
                : "measured",
            observation: o ?? null,
          };
        }),
        recommendations: recommendations.map(presentRecommendation),
      };
    });
  });
  app.get("/api/v1/admin/infrastructure/observations/:id", async (req) => {
    const a = access(req),
      id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    return db.system(async (tx) => {
      const [row] = await tx.query(
        "SELECT * FROM infrastructure_observations WHERE id=$1",
        [id],
      );
      if (!row)
        throw fail(404, "OBSERVATION_NOT_FOUND", "Observation not found.");
      await audit(tx, a, "infrastructure.evidence.read", id);
      return row;
    });
  });
  app.get("/api/v1/admin/infrastructure/policies", async (req) => {
    const a = access(req);
    return db.system(async (tx) => {
      await audit(tx, a, "infrastructure.policy.read", null);
      return tx.query(
        "SELECT * FROM infrastructure_policies ORDER BY revision DESC LIMIT 100",
      );
    });
  });
  app.post("/api/v1/admin/infrastructure/policy", async (req) => {
    const a = access(req),
      b = z
        .object({
          requestId: z.string().uuid(),
          revision: z.number().int().positive(),
          thresholds: infrastructureThresholds,
          reasonCode: z.enum([
            "capacity_review",
            "incident_review",
            "baseline_tuning",
            "release_review",
          ]),
        })
        .strict()
        .parse(req.body);
    return mutation(
      db,
      a,
      b.requestId,
      "infrastructure.policy.changed",
      b,
      async (tx) => {
        const current = await currentPolicy(tx);
        if (b.revision !== current.revision) throw conflict();
        const [policy] = await tx.query<Policy>(
          "INSERT INTO infrastructure_policies(revision,thresholds,reason_code,created_by) VALUES($1,$2,$3,$4) RETURNING *",
          [
            current.revision + 1,
            JSON.stringify(b.thresholds),
            b.reasonCode,
            a.userId,
          ],
        );
        await evaluate(tx, policy, await latestObservations(tx), Date.now());
        return policy;
      },
    );
  });
  app.post(
    "/api/v1/admin/infrastructure/recommendations/:id/:action",
    async (req) => {
      const a = access(req),
        { id, action } = z
          .object({
            id: z.string().uuid(),
            action: z.enum(["acknowledge", "resolve"]),
          })
          .parse(req.params),
        b = z
          .object({
            requestId: z.string().uuid(),
            revision: z.number().int().positive(),
            evidenceId: z.string().uuid(),
            policyRevision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
      return mutation(
        db,
        a,
        b.requestId,
        `infrastructure.recommendation.${action}`,
        { id, action, ...b },
        async (tx) => {
          const policy = await currentPolicy(tx),
            observations = await latestObservations(tx),
            now = Date.now();
          await evaluate(tx, policy, observations, now);
          const [row] = await tx.query(
            "SELECT * FROM infrastructure_recommendations WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (!row)
            throw fail(
              404,
              "RECOMMENDATION_NOT_FOUND",
              "Recommendation not found.",
            );
          if (
            row.revision !== b.revision ||
            row.latest_observation_id !== b.evidenceId ||
            row.policy_revision !== b.policyRevision ||
            policy.revision !== b.policyRevision
          )
            throw conflict();
          if (
            row.status === "resolved" ||
            (action === "acknowledge" && row.status !== "open")
          )
            throw conflict();
          if (action === "resolve") {
            const o = observations.find((x) => x.service === row.service);
            const value = o ? ruleValue(row.rule, o, policy, now) : null;
            if (
              !o ||
              o.id !== b.evidenceId ||
              value === null ||
              value > policy.thresholds[rules[row.rule].threshold] ||
              row.recovery_observation_id !== o.id
            )
              throw fail(
                409,
                "FRESH_RECOVERY_REQUIRED",
                "A fresh, complete observation within the current threshold is required to resolve this recommendation.",
              );
          }
          const [updated] = await tx.query(
            `UPDATE infrastructure_recommendations SET status=$2,revision=revision+1,${action === "acknowledge" ? "acknowledged_at" : "resolved_at"}=now(),updated_at=now() WHERE id=$1 RETURNING *`,
            [id, action === "acknowledge" ? "acknowledged" : "resolved"],
          );
          return presentRecommendation(updated);
        },
      );
    },
  );
  for (const path of [
    "/api/v1/admin/infrastructure/actions",
    "/api/v1/admin/infrastructure/actions/:action",
  ])
    app.post(path, async (req, reply) => {
      const a = access(req);
      await db.system((tx) =>
        audit(tx, a, "infrastructure.execution.denied", null, {
          code: "OBSERVE_ONLY",
        }),
      );
      return reply.code(403).send({
        code: "INFRASTRUCTURE_OBSERVE_ONLY",
        message:
          "Infrastructure execution is disabled. This service only records observations and recommendations.",
      });
    });
  return reporter;
}
