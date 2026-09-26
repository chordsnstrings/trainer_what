import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, type Tx, event } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";

type Identity = Actor & { platformRole: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const conflict = () =>
  fail(
    409,
    "REVISION_CONFLICT",
    "This item changed. Reload before continuing.",
  );
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/);
const documentKind = z.enum([
  "legal",
  "notification",
  "support_macro",
  "safety",
]);
const documentBody = z
  .object({
    kind: documentKind,
    key: slug,
    title: z.string().trim().min(3).max(150),
    content: z.string().trim().min(5).max(60000),
  })
  .strict();
const views = [
  "trainers",
  "subscribers",
  "brains",
  "safety",
  "finops",
  "wearables",
  "domains",
  "infrastructure",
  "support",
  "security",
  "acquisition",
  "experiments",
  "configuration",
] as const;
const scopes: Record<string, readonly string[]> = {
  admin: views,
  finance: ["trainers", "subscribers", "finops"],
  support: ["trainers", "subscribers", "support", "wearables", "domains"],
  safety: ["trainers", "subscribers", "brains", "safety"],
};
async function audit(
  tx: Tx,
  a: Identity,
  action: string,
  tenantId?: string,
  subjectId?: string,
  data: unknown = {},
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,tenant_id,subject_id,data) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      a.userId,
      action,
      tenantId ?? null,
      subjectId ?? null,
      JSON.stringify(data),
    ],
  );
}
export async function getPublishedDocument(
  db: Database,
  kind: string,
  key: string,
) {
  return db.system(
    async (tx) =>
      (
        await tx.query(
          "SELECT id,kind,key,version,title,content,effective_at,published_at FROM admin_documents WHERE kind=$1 AND key=$2 AND status='published' AND effective_at<=now() ORDER BY effective_at DESC,version DESC LIMIT 1",
          [kind, key],
        )
      )[0] ?? null,
  );
}
export function consentedAcquisition(cookieValue?: string) {
  try {
    const raw = JSON.parse(decodeURIComponent(cookieValue ?? ""));
    return z
      .object({
        consent: z.literal(true),
        visitorId: z.string().uuid(),
        source: z.string().regex(/^[a-zA-Z0-9._ -]{1,80}$/),
        campaign: z
          .string()
          .regex(/^[a-zA-Z0-9._ -]{0,80}$/)
          .default(""),
        medium: z
          .string()
          .regex(/^[a-zA-Z0-9._ -]{0,40}$/)
          .default(""),
      })
      .strict()
      .parse(raw);
  } catch {
    return null;
  }
}
export async function recordAcquisition(
  db: Database,
  input: {
    eventKey: string;
    name: "landing" | "signup" | "publish" | "lead";
    tenantId?: string;
    userId?: string;
    visitorId: string;
    source: string;
    campaign?: string;
    medium?: string;
  },
) {
  const b = z
    .object({
      eventKey: z.string().min(1).max(200),
      name: z.enum(["landing", "signup", "publish", "lead"]),
      tenantId: z.string().uuid().optional(),
      userId: z.string().uuid().optional(),
      visitorId: z.string().uuid(),
      source: z.string().regex(/^[a-zA-Z0-9._ -]{1,80}$/),
      campaign: z
        .string()
        .regex(/^[a-zA-Z0-9._ -]{0,80}$/)
        .default(""),
      medium: z
        .string()
        .regex(/^[a-zA-Z0-9._ -]{0,40}$/)
        .default(""),
    })
    .strict()
    .parse(input);
  return db.system((tx) =>
    tx.query(
      "INSERT INTO acquisition_events(id,event_key,name,tenant_id,user_id,visitor_id,source,campaign,medium) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(event_key) DO NOTHING",
      [
        randomUUID(),
        b.eventKey,
        b.name,
        b.tenantId ?? null,
        b.userId ?? null,
        b.visitorId,
        b.source,
        b.campaign,
        b.medium,
      ],
    ),
  );
}
export async function businessAnalytics(db: Database, a: Actor) {
  return db.tenant(a, async (tx) => ({
    members: await tx.query(
      "SELECT status,count(*)::int AS members,coalesce(sum(price_minor),0)::text AS recurring_minor FROM subscriptions GROUP BY status ORDER BY status",
    ),
    cohorts: await tx.query(
      "SELECT to_char(u.created_at,'YYYY-MM') AS cohort,count(*)::int AS joined,count(*) FILTER(WHERE s.status IN ('active','trialing'))::int AS active,count(*) FILTER(WHERE s.status IN ('canceled','unpaid'))::int AS ended FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN subscriptions s ON s.user_id=m.user_id AND s.tenant_id=m.tenant_id WHERE m.role='subscriber' GROUP BY 1 ORDER BY 1 DESC LIMIT 24",
    ),
    revenue: await tx.query(
      "SELECT to_char(j.created_at,'YYYY-MM') AS month,l.account,sum(l.amount_minor)::text AS amount_minor FROM journals j JOIN journal_lines l ON l.journal_id=j.id AND l.tenant_id=j.tenant_id WHERE j.created_at>now()-interval '24 months' AND l.account IN ('gross_revenue','trainer_payable','commission_revenue','platform_commission','refunds') GROUP BY 1,2 ORDER BY 1 DESC,2",
    ),
    note: "Cohorts use account join month and current subscription state. Recurring values are current price totals, not recognized revenue. No health, meal, or coaching data is used for growth reporting.",
  }));
}
export function registerAdminOperations(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  const access = (req: FastifyRequest, view: string) => {
    const a = identity(req);
    if (!scopes[a.platformRole]?.includes(view))
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Your operator role does not allow this view.",
      );
    requireRecentMfa(a, true);
    return a;
  };
  app.get("/api/v1/public/documents/:key", async (req) => {
    const key = z
      .enum(["terms", "privacy", "ai-disclosure"])
      .parse((req.params as any).key);
    const q = z
      .object({ version: z.coerce.number().int().min(1).optional() })
      .parse(req.query);
    const current = q.version
      ? await db.system(
          async (tx) =>
            (
              await tx.query(
                "SELECT id,kind,key,version,title,content,effective_at,published_at FROM admin_documents WHERE kind='legal' AND key=$1 AND version=$2 AND status='published' AND effective_at<=now()",
                [key, q.version],
              )
            )[0] ?? null,
        )
      : await getPublishedDocument(db, "legal", key);
    if (!current)
      throw fail(
        404,
        "LEGAL_NOT_PUBLISHED",
        "An approved document has not been published yet.",
      );
    const versions = await db.system((tx) =>
      tx.query(
        "SELECT version,effective_at FROM admin_documents WHERE kind='legal' AND key=$1 AND status='published' AND effective_at<=now() ORDER BY effective_at DESC,version DESC",
        [key],
      ),
    );
    return { document: current, versions };
  });
  app.get("/api/v1/analytics/business", async (req) => {
    const a = identity(req);
    if (!["owner", "finance"].includes(a.role))
      throw fail(403, "FINANCE_SCOPE", "Owner or finance access is required.");
    return businessAnalytics(db, a);
  });
  app.get("/api/v1/admin/operations/:view", async (req) => {
    const view = z.enum(views).parse((req.params as any).view),
      a = access(req, view);
    const q = z
      .object({
        tenantId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const tenants = await db.system((tx) =>
      tx.query(
        "SELECT id,slug,name,published,created_at FROM tenants ORDER BY created_at DESC LIMIT 500",
      ),
    );
    if (q.tenantId && !tenants.some((t) => t.id === q.tenantId))
      throw fail(404, "TENANT_NOT_FOUND", "Workspace unavailable.");
    await db.system((tx) =>
      audit(tx, a, "operations." + view + ".read", q.tenantId, q.userId),
    );
    const selected = q.tenantId
      ? tenants.filter((t) => t.id === q.tenantId)
      : tenants.slice(q.page * 25, q.page * 25 + 25);
    let rows: any[] = [],
      summary: any = {},
      documents: any[] = [];
    if (view === "configuration")
      documents = await db.system((tx) =>
        tx.query(
          "SELECT * FROM admin_documents ORDER BY created_at DESC LIMIT 200",
        ),
      );
    else if (view === "experiments")
      rows = await db.system((tx) =>
        tx.query(
          "SELECT * FROM admin_experiments ORDER BY created_at DESC LIMIT 100",
        ),
      );
    else if (view === "acquisition") {
      rows = await db.system((tx) =>
        tx.query(
          "SELECT source,campaign,medium,count(DISTINCT visitor_id) FILTER(WHERE name='landing')::int AS visitors,count(DISTINCT tenant_id) FILTER(WHERE name='signup')::int AS signups,count(DISTINCT tenant_id) FILTER(WHERE name='publish')::int AS published,count(*) FILTER(WHERE name='lead')::int AS leads FROM acquisition_events WHERE created_at>now()-interval '90 days' GROUP BY source,campaign,medium ORDER BY signups DESC LIMIT 100",
        ),
      );
      summary = {
        period: "90 days",
        attribution:
          "Only explicit analytics consent. Unique visitor and workspace counts; no health targeting.",
      };
    } else if (view === "security") {
      rows = await db.system((tx) =>
        tx.query(
          "SELECT o.id,o.action,o.tenant_id,o.subject_id,o.created_at,u.name AS operator FROM admin_operations_audit o JOIN users u ON u.id=o.actor_id ORDER BY o.created_at DESC LIMIT 200",
        ),
      );
      summary = {
        operators: await db.system((tx) =>
          tx.query(
            "SELECT u.id,u.name,u.platform_role,coalesce(s.enabled,false) AS mfa_enabled FROM users u LEFT JOIN user_security s ON s.user_id=u.id WHERE u.platform_role<>'none'",
          ),
        ),
      };
    } else {
      for (const t of selected) {
        const result = await db.tenant(
          { ...a, tenantId: t.id, role: "owner" },
          async (tx) => {
            if (view === "trainers") {
              const [r] = await tx.query(
                "SELECT count(*) FILTER(WHERE role='subscriber')::int AS subscribers FROM memberships WHERE tenant_id=$1",
                [t.id],
              );
              const [owner] = await tx.query(
                "SELECT u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='owner' LIMIT 1",
                [t.id],
              );
              const [brain] = await tx.query(
                "SELECT version,status,created_at FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC LIMIT 1",
              );
              return [
                {
                  id: t.id,
                  workspace: t.name,
                  slug: t.slug,
                  published: t.published,
                  owner: owner?.name,
                  ownerEmail: owner?.email,
                  subscribers: r.subscribers,
                  brainVersion: brain?.version ?? null,
                },
              ];
            }
            if (view === "subscribers") {
              const people = await tx.query(
                "SELECT u.id,u.name,u.email,m.role,s.status AS subscription_status,s.period_end,s.cancel_at_period_end FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN subscriptions s ON s.user_id=m.user_id AND s.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.role='subscriber' AND ($2::uuid IS NULL OR u.id=$2) ORDER BY u.created_at DESC LIMIT 200",
                [t.id, q.userId ?? null],
              );
              return people;
            }
            if (view === "brains")
              return tx.query(
                "SELECT id,kind,status,version,created_at,data->>'score' AS score,data->>'releaseId' AS release_id FROM records WHERE kind IN ('brain_release','evaluation','coaching_evaluation') ORDER BY created_at DESC LIMIT 100",
              );
            if (view === "safety")
              return tx.query(
                "SELECT id,kind,status,version,owner_user_id,created_at,data->>'category' AS category,data->>'severity' AS severity,data->>'reason' AS reason,data->'operatorReview' AS operator_review FROM records WHERE kind IN ('exception','nutrition_exception') ORDER BY created_at DESC LIMIT 100",
              );
            if (view === "finops")
              return tx.query(
                "SELECT task,provider,model,status,count(*)::int AS requests,sum(input_tokens)::text AS input_tokens,sum(output_tokens)::text AS output_tokens,sum(cost_usd)::text AS cost_usd,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unresolved FROM cost_events WHERE created_at>now()-interval '30 days' GROUP BY task,provider,model,status ORDER BY task,provider",
              );
            if (view === "support")
              return tx.query(
                "SELECT r.id,r.owner_user_id,r.status,r.version,r.created_at,r.updated_at,u.name,r.data->>'subject' AS subject,r.data->>'category' AS category,r.data->'messages' AS messages,extract(epoch FROM(now()-r.created_at))/3600 AS age_hours FROM records r LEFT JOIN users u ON u.id=r.owner_user_id WHERE kind='support' ORDER BY r.updated_at DESC LIMIT 100",
              );
            if (view === "domains")
              return tx.query(
                "SELECT hostname,active,verified_at FROM domain_mappings WHERE tenant_id=$1",
                [t.id],
              );
            if (view === "wearables")
              return tx.query(
                "SELECT id,owner_user_id,status,created_at,updated_at,data->>'provider' AS provider,data->>'source' AS source,data->>'lastSyncAt' AS last_sync_at,data->>'errorCode' AS error_code FROM records WHERE kind IN ('wearable','wearable_connection') ORDER BY updated_at DESC LIMIT 100",
              );
            if (view === "infrastructure")
              return tx.query(
                "SELECT id,kind,status,attempts,available_at,leased_until,created_at FROM jobs WHERE status IN ('pending','blocked','failed') ORDER BY created_at LIMIT 100",
              );
            return [];
          },
        );
        rows.push(
          ...result.map((r) => ({ ...r, tenant_id: t.id, workspace: t.name })),
        );
      }
    }
    const macros =
      view === "support"
        ? await db.system((tx) =>
            tx.query(
              "SELECT DISTINCT ON (key) key,title,content,version FROM admin_documents WHERE kind='support_macro' AND status='published' AND effective_at<=now() ORDER BY key,effective_at DESC,version DESC",
            ),
          )
        : [];
    return {
      view,
      allowedViews: scopes[a.platformRole],
      tenants,
      selectedTenant: q.tenantId ?? "",
      rows,
      documents,
      macros,
      summary,
      page: q.page,
      hasMore: !q.tenantId && tenants.length > (q.page + 1) * 25,
    };
  });
  app.post("/api/v1/admin/documents", async (req) => {
    const a = access(req, "configuration"),
      b = documentBody.parse(req.body);
    if (
      b.kind === "legal" &&
      !["terms", "privacy", "ai-disclosure"].includes(b.key)
    )
      throw fail(
        400,
        "DOCUMENT_KEY",
        "Choose terms, privacy, or ai-disclosure.",
      );
    if (
      b.kind === "notification" &&
      /\{\{(?!\s*(name|link|coach|date|message)\s*\}\})/.test(b.content)
    )
      throw fail(
        400,
        "TEMPLATE_VARIABLE",
        "Use only name, link, coach, date, and message template variables.",
      );
    return db.system(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "document:" + b.kind + ":" + b.key,
      ]);
      const [last] = await tx.query(
        "SELECT coalesce(max(version),0)::int AS version FROM admin_documents WHERE kind=$1 AND key=$2",
        [b.kind, b.key],
      );
      const [r] = await tx.query(
        "INSERT INTO admin_documents(id,kind,key,version,title,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          randomUUID(),
          b.kind,
          b.key,
          last.version + 1,
          b.title,
          b.content,
          a.userId,
        ],
      );
      await audit(tx, a, "document.created", undefined, r.id, {
        kind: b.kind,
        key: b.key,
        version: r.version,
      });
      return r;
    });
  });
  app.post("/api/v1/admin/documents/:id/publish", async (req) => {
    const a = access(req, "configuration"),
      documentId = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    const b = z
      .object({
        revision: z.number().int().min(1),
        effectiveAt: z.iso.datetime(),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(req.body);
    if (new Date(b.effectiveAt).getTime() < Date.now() - 60000)
      throw fail(
        400,
        "EFFECTIVE_DATE",
        "Publish now or schedule a future effective date.",
      );
    return db.system(async (tx) => {
      const [r] = await tx.query(
        "UPDATE admin_documents SET status='published',revision=revision+1,effective_at=$3,published_at=now(),published_by=$4 WHERE id=$1 AND revision=$2 AND status='draft' RETURNING *",
        [documentId, b.revision, b.effectiveAt, a.userId],
      );
      if (!r) throw conflict();
      await audit(tx, a, "document.published", undefined, r.id, {
        version: r.version,
        reason: b.reason,
        effectiveAt: b.effectiveAt,
      });
      return r;
    });
  });
  app.post("/api/v1/admin/tenants/:tenantId/support/:id/reply", async (req) => {
    const a = access(req, "support"),
      p = z
        .object({ tenantId: z.string().uuid(), id: z.string().uuid() })
        .parse(req.params);
    const b = z
      .object({
        revision: z.number().int().min(1),
        message: z.string().trim().min(1).max(4000),
        resolve: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const result = await db.tenant(
      { ...a, tenantId: p.tenantId, role: "owner" },
      async (tx) => {
        const [r] = await tx.query(
          "SELECT * FROM records WHERE id=$1 AND kind='support' FOR UPDATE",
          [p.id],
        );
        if (!r) throw fail(404, "NOT_FOUND", "Conversation unavailable.");
        if (r.version !== b.revision) throw conflict();
        const messages = Array.isArray(r.data.messages) ? r.data.messages : [];
        if (messages.length >= 100)
          throw fail(409, "THREAD_LIMIT", "Start a new conversation.");
        const data = {
          ...r.data,
          messages: [
            ...messages,
            {
              text: b.message,
              authorId: a.userId,
              at: new Date().toISOString(),
              platformSupport: true,
            },
          ],
        };
        const [updated] = await tx.query(
          "UPDATE records SET data=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING id,version,status",
          [r.id, JSON.stringify(data), b.resolve ? "resolved" : "open"],
        );
        await event(
          tx,
          { ...a, tenantId: p.tenantId },
          "support.operator_replied",
          r.id,
          { resolved: b.resolve },
        );
        return updated;
      },
    );
    await db.system((tx) =>
      audit(tx, a, "support.reply", p.tenantId, p.id, { resolved: b.resolve }),
    );
    return result;
  });
  app.post("/api/v1/admin/tenants/:tenantId/safety/:id/review", async (req) => {
    const a = access(req, "safety"),
      p = z
        .object({ tenantId: z.string().uuid(), id: z.string().uuid() })
        .parse(req.params);
    const b = z
      .object({
        revision: z.number().int().min(1),
        note: z.string().trim().min(10).max(2000),
        priority: z.enum(["routine", "urgent"]),
      })
      .strict()
      .parse(req.body);
    return db.tenant(
      { ...a, tenantId: p.tenantId, role: "owner" },
      async (tx) => {
        const [r] = await tx.query(
          "UPDATE records SET data=data||jsonb_build_object('operatorReview',$3::jsonb),version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND kind IN ('exception','nutrition_exception') RETURNING id,version,status",
          [
            p.id,
            b.revision,
            JSON.stringify({
              ...b,
              reviewer: a.userId,
              at: new Date().toISOString(),
            }),
          ],
        );
        if (!r) throw conflict();
        await event(
          tx,
          { ...a, tenantId: p.tenantId },
          "safety.operator_review",
          r.id,
          { priority: b.priority },
        );
        return r;
      },
    );
  });
  app.post(
    "/api/v1/admin/tenants/:tenantId/email-jobs/:id/reconcile",
    async (req) => {
      const a = access(req, "infrastructure"),
        p = z
          .object({ tenantId: z.string().uuid(), id: z.string().uuid() })
          .parse(req.params);
      const b = z
        .object({
          attempts: z.number().int().min(0),
          outcome: z.enum(["not_sent", "delivered"]),
          evidenceReference: z.string().trim().min(10).max(500),
        })
        .strict()
        .parse(req.body);
      return db.tenant(
        { ...a, tenantId: p.tenantId, role: "owner" },
        async (tx) => {
          const [r] = await tx.query(
            "UPDATE jobs SET status=$3,available_at=now(),leased_until=NULL,last_error=NULL WHERE id=$1 AND kind='email' AND status IN ('blocked','failed') AND attempts=$2 AND (leased_until IS NULL OR leased_until<now()) RETURNING id,status,attempts",
            [
              p.id,
              b.attempts,
              b.outcome === "delivered" ? "completed" : "pending",
            ],
          );
          if (!r)
            throw fail(
              409,
              "JOB_NOT_RECOVERABLE",
              "Only an unleased blocked email with the observed attempt count can be reconciled.",
            );
          await event(
            tx,
            { ...a, tenantId: p.tenantId },
            "email.operator_reconciled",
            r.id,
            { ...b },
          );
          return r;
        },
      );
    },
  );
  app.post("/api/v1/admin/experiments", async (req) => {
    const a = access(req, "experiments"),
      b = z
        .object({
          key: slug,
          title: z.string().trim().min(3).max(150),
          surface: z.enum(["landing", "onboarding"]),
          allocation: z.number().int().min(1).max(50),
          variantA: z.string().trim().min(1).max(200),
          variantB: z.string().trim().min(1).max(200),
          metric: z.enum(["signup", "publish"]),
          guardrail: z.string().trim().min(10).max(2000),
        })
        .strict()
        .parse(req.body);
    return db.system(async (tx) => {
      const [r] = await tx.query(
        "INSERT INTO admin_experiments(id,key,title,surface,allocation,variant_a,variant_b,metric,guardrail,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          randomUUID(),
          b.key,
          b.title,
          b.surface,
          b.allocation,
          b.variantA,
          b.variantB,
          b.metric,
          b.guardrail,
          a.userId,
        ],
      );
      await audit(tx, a, "experiment.created", undefined, r.id);
      return r;
    });
  });
  app.post("/api/v1/admin/experiments/:id/transition", async (req) => {
    const a = access(req, "experiments"),
      experimentId = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    const b = z
      .object({
        revision: z.number().int().min(1),
        status: z.enum(["running", "stopped", "completed"]),
        result: z.string().trim().min(10).max(4000),
      })
      .strict()
      .parse(req.body);
    return db.system(async (tx) => {
      const [r] = await tx.query(
        "UPDATE admin_experiments SET status=$3,result=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND ((status='draft' AND $3='running') OR (status='running' AND $3 IN ('stopped','completed'))) RETURNING *",
        [experimentId, b.revision, b.status, b.result],
      );
      if (!r) throw conflict();
      await audit(tx, a, "experiment." + b.status, undefined, r.id, {
        reason: b.result,
      });
      return r;
    });
  });
  app.get("/api/v1/public/experiments/:key", async (req) => {
    const key = slug.parse((req.params as any).key),
      consent = consentedAcquisition(req.cookies?.acquisition);
    if (!consent)
      return { variant: "control", reason: "Analytics consent is required." };
    const experiment = await db.system(
      async (tx) =>
        (
          await tx.query(
            "SELECT id,revision,allocation,variant_a,variant_b FROM admin_experiments WHERE key=$1 AND status='running'",
            [key],
          )
        )[0],
    );
    if (!experiment) return { variant: "control" };
    const bucket =
      createHash("sha256")
        .update(experiment.id + ":" + consent.visitorId)
        .digest()
        .readUInt32BE(0) % 100;
    return {
      experimentId: experiment.id,
      revision: experiment.revision,
      variant:
        bucket < experiment.allocation
          ? experiment.variant_b
          : experiment.variant_a,
    };
  });
}
