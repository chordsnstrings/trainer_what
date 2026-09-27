import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, type Tx, event } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { assertNotificationDocument } from "./message-templates.ts";
import { createdKey, keysetPage } from "./workspace-pages.ts";
import {
  EFFECTIVE_DUE_SQL,
  PINNED_DUE_SQL,
  assertSafetyPolicyDocument,
  effectiveSafetyPolicy,
} from "../../../packages/domain/src/safety-policy.ts";

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
const attributionTouch = z
  .object({
    source: z.string().max(80),
    campaign: z.string().max(80),
    medium: z.string().max(40),
    referral: z.string().regex(/^[a-zA-Z0-9_-]{0,40}$/),
    /** Workspace whose page captured the touch (never shown to visitors). */
    site: z.string().uuid().optional(),
  })
  .strict();
type AttributionTouch = z.infer<typeof attributionTouch>;
export async function recordAcquisition(
  db: Database,
  input: {
    eventKey: string;
    name: "landing" | "signup" | "enroll" | "publish" | "lead" | "first_paid" | "experiment_exposure";
    tenantId?: string;
    userId?: string;
    visitorId: string;
    source: string;
    campaign?: string;
    medium?: string;
    attribution?: {
      first: AttributionTouch;
      last: AttributionTouch;
      /** Lead events: only the touches captured on the lead workspace's pages. */
      workspace?: { first?: AttributionTouch; last?: AttributionTouch };
    };
    experimentId?: string;
    experimentRevision?: number;
    variant?: "a" | "b";
  },
  transaction?: Tx,
) {
  const b = z
    .object({
      eventKey: z.string().min(1).max(200),
      name: z.enum(["landing", "signup", "enroll", "publish", "lead", "first_paid", "experiment_exposure"]),
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
      attribution: z.object({
        first: attributionTouch,
        last: attributionTouch,
        workspace: z
          .object({ first: attributionTouch.optional(), last: attributionTouch.optional() })
          .strict()
          .optional(),
      }).strict().optional(),
      experimentId: z.string().uuid().optional(),
      experimentRevision: z.number().int().positive().optional(),
      variant: z.enum(["a", "b"]).optional(),
    })
    .strict()
    .parse(input);
  const write = (tx: Tx) => tx.query(
      "INSERT INTO acquisition_events(id,event_key,name,tenant_id,user_id,visitor_id,source,campaign,medium,attribution,experiment_id,experiment_revision,variant) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(event_key) DO NOTHING RETURNING id",
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
        JSON.stringify(b.attribution ?? {}), b.experimentId ?? null, b.experimentRevision ?? null, b.variant ?? null,
      ],
    );
  return transaction ? write(transaction) : db.system(write);
}
/**
 * Website inquiries are the workspace's own records and are always counted.
 * Source, campaign and referral exist only for visitors who allowed optional
 * analytics (lead events), and only for touches captured on this
 * workspace's own pages; the platform's and other workspaces' campaigns stay
 * in the operator funnel. Owner only: finance cannot read inquiry records.
 */
export async function leadAnalytics(db: Database, a: Actor) {
  const monthly = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT to_char(created_at,'YYYY-MM') AS month,count(*)::int AS inquiries,count(*) FILTER(WHERE status='handled')::int AS handled FROM records WHERE kind='website_inquiry' AND created_at>now()-interval '12 months' GROUP BY 1 ORDER BY 1 DESC",
    ),
  );
  const attributed = await db.system((tx) =>
    tx.query(
      "SELECT to_char(created_at,'YYYY-MM') AS month,count(*) FILTER(WHERE attribution->'workspace'->'first' IS NOT NULL OR attribution->'workspace'->'last' IS NOT NULL)::int AS attributed FROM acquisition_events WHERE tenant_id=$1 AND name='lead' AND created_at>now()-interval '12 months' GROUP BY 1",
      [a.tenantId],
    ),
  );
  const sources = await db.system((tx) =>
    tx.query(
      "WITH l AS (SELECT e.visitor_id,e.tenant_id,e.created_at,coalesce(e.attribution->'workspace'->'first',e.attribution->'workspace'->'last') AS t,e.attribution->'workspace' AS w FROM acquisition_events e WHERE e.tenant_id=$1 AND e.name='lead' AND e.created_at>now()-interval '90 days') SELECT coalesce(t->>'source','') AS source,coalesce(t->>'campaign','') AS campaign,coalesce(t->>'medium','') AS medium,coalesce(nullif(w->'last'->>'referral',''),nullif(w->'first'->>'referral',''),'') AS referral,(t IS NULL) AS outside,count(*)::int AS leads,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM acquisition_events j WHERE j.visitor_id=l.visitor_id AND j.tenant_id=l.tenant_id AND j.name='enroll' AND j.created_at>=l.created_at))::int AS joined FROM l GROUP BY 1,2,3,4,5 ORDER BY leads DESC,5,1 LIMIT 50",
      [a.tenantId],
    ),
  );
  const byMonth = new Map(attributed.map((r) => [r.month, r.attributed]));
  return {
    monthly: monthly.map((r) => ({
      ...r,
      attributed: byMonth.get(r.month) ?? 0,
    })),
    sources,
    note: "Every website inquiry is counted. Source, campaign and referral are shown only for visitors who allowed optional analytics, and only from visits to your own website pages; withdrawing that permission removes their attribution. Joined counts leads whose visitor later joined your coaching.",
  };
}
export async function businessAnalytics(db: Database, a: Actor) {
  // Inquiries are not finance records: the finance role gets no lead card.
  const leads = a.role === "owner" ? await leadAnalytics(db, a) : null;
  // Account join months come from the account registry, which tenant
  // transactions cannot read; subscription state stays tenant-scoped.
  const joined = await db.system((tx) =>
    tx.query(
      "SELECT m.user_id,to_char(u.created_at,'YYYY-MM') AS cohort FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='subscriber'",
      [a.tenantId],
    ),
  );
  return db.tenant(a, async (tx) => ({
    leads,
    members: await tx.query(
      "SELECT status,count(*)::int AS members,coalesce(sum(price_minor),0)::text AS recurring_minor FROM subscriptions GROUP BY status ORDER BY status",
    ),
    cohorts: await (async () => {
      const status = new Map(
        (await tx.query("SELECT user_id,status FROM subscriptions")).map(
          (s) => [s.user_id, s.status],
        ),
      );
      const cohorts = new Map<
        string,
        { cohort: string; joined: number; active: number; ended: number }
      >();
      for (const m of joined) {
        const c = cohorts.get(m.cohort) ?? {
          cohort: m.cohort,
          joined: 0,
          active: 0,
          ended: 0,
        };
        const s = status.get(m.user_id);
        c.joined++;
        if (s === "active" || s === "trialing") c.active++;
        if (s === "canceled" || s === "unpaid") c.ended++;
        cohorts.set(m.cohort, c);
      }
      return [...cohorts.values()]
        .sort((x, y) => y.cohort.localeCompare(x.cohort))
        .slice(0, 24);
    })(),
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
        // Keyset position of the workspace page (newest first) and of the
        // security audit list; `page` remains for older clients.
        cursor: z.string().max(1000).optional(),
        rowsCursor: z.string().max(1000).optional(),
      })
      .parse(req.query);
    // The workspace picker lists the 500 most recent; paging and a selected
    // workspace are resolved directly, so older workspaces stay reachable.
    const tenants = await db.system((tx) =>
      tx.query(
        "SELECT id,slug,name,published,created_at FROM tenants ORDER BY created_at DESC,id DESC LIMIT 500",
      ),
    );
    let selected: any[],
      nextCursor: string | null = null,
      hasMore = false;
    if (q.tenantId) {
      selected = await db.system((tx) =>
        tx.query(
          "SELECT id,slug,name,published,created_at FROM tenants WHERE id=$1",
          [q.tenantId],
        ),
      );
      if (!selected.length)
        throw fail(404, "TENANT_NOT_FOUND", "Workspace unavailable.");
    } else if (q.cursor !== undefined) {
      const page = await db.system((tx) =>
        keysetPage(tx, {
          select: "id,slug,name,published,created_at",
          from: "tenants",
          key: createdKey(),
          descending: true,
          cursor: q.cursor,
          limit: 25,
        }),
      );
      selected = page.items;
      nextCursor = page.cursor;
      hasMore = page.hasMore;
    } else {
      const page = await db.system((tx) =>
        tx.query(
          "SELECT id,slug,name,published,created_at FROM tenants ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET $1",
          [q.page * 25],
        ),
      );
      hasMore = page.length > 25;
      selected = page.slice(0, 25);
    }
    await db.system((tx) =>
      audit(tx, a, "operations." + view + ".read", q.tenantId, q.userId),
    );
    let rows: any[] = [],
      summary: any = {},
      documents: any[] = [],
      rowsCursor: string | null = null,
      rowsHasMore = false;
    if (view === "configuration")
      documents = await db.system((tx) =>
        tx.query(
          "SELECT * FROM admin_documents ORDER BY created_at DESC LIMIT 200",
        ),
      );
    else if (view === "experiments")
      rows = await db.system((tx) =>
        tx.query(
          "SELECT x.*, (SELECT count(*)::int FROM acquisition_events e WHERE e.experiment_id=x.id AND e.name='experiment_exposure' AND e.variant='a') AS exposures_a,(SELECT count(*)::int FROM acquisition_events e WHERE e.experiment_id=x.id AND e.name='experiment_exposure' AND e.variant='b') AS exposures_b,(SELECT count(DISTINCT c.tenant_id)::int FROM acquisition_events e JOIN acquisition_events c ON c.visitor_id=e.visitor_id AND c.name=x.metric AND c.created_at>=e.created_at WHERE e.experiment_id=x.id AND e.name='experiment_exposure' AND e.variant='a') AS conversions_a,(SELECT count(DISTINCT c.tenant_id)::int FROM acquisition_events e JOIN acquisition_events c ON c.visitor_id=e.visitor_id AND c.name=x.metric AND c.created_at>=e.created_at WHERE e.experiment_id=x.id AND e.name='experiment_exposure' AND e.variant='b') AS conversions_b FROM admin_experiments x ORDER BY created_at DESC LIMIT 100",
        ),
      );
    else if (view === "acquisition") {
      rows = await db.system((tx) =>
        tx.query(
          "SELECT source,campaign,medium,count(DISTINCT visitor_id) FILTER(WHERE name='landing')::int AS visitors,count(DISTINCT tenant_id) FILTER(WHERE name='signup')::int AS signups,count(DISTINCT tenant_id) FILTER(WHERE name='publish')::int AS published,count(*) FILTER(WHERE name='lead')::int AS leads,count(DISTINCT user_id) FILTER(WHERE name='enroll')::int AS enrolled,count(DISTINCT tenant_id) FILTER(WHERE name='first_paid')::int AS first_paid FROM acquisition_events WHERE created_at>now()-interval '90 days' GROUP BY source,campaign,medium ORDER BY signups DESC LIMIT 100",
        ),
      );
      summary = {
        period: "90 days",
        attribution:
          "Explicit optional analytics permission only. Source columns use first touch; events retain the last tagged touch and referral code. Leads are website inquiries from consenting visitors. First paid counts workspaces with a verified positive subscription or paid-session journal. No health targeting or referral commission.",
      };
    } else if (view === "security") {
      const page = await db.system((tx) =>
        keysetPage(tx, {
          select:
            "o.id,o.action,o.tenant_id,o.subject_id,o.created_at,u.name AS operator",
          from: "admin_operations_audit o JOIN users u ON u.id=o.actor_id",
          key: createdKey("o."),
          descending: true,
          cursor: q.rowsCursor,
          limit: 100,
        }),
      );
      rows = page.items;
      rowsCursor = page.cursor;
      rowsHasMore = page.hasMore;
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
            if (view === "safety") {
              // The due time shown is the one that escalates: the earlier of
              // the pinned deadline and the current policy's.
              const [published] = await tx.query(
                "SELECT published_safety_policy() AS value",
              );
              const policy = effectiveSafetyPolicy(published?.value ?? null);
              return tx.query(
                `SELECT id,kind,status,version,owner_user_id,created_at,data->>'category' AS category,data->>'severity' AS severity,data->>'reason' AS reason,data->'operatorReview' AS operator_review,CASE WHEN kind='exception' AND status='open' AND data->>'category' IN ('safety','policy_review') THEN ${EFFECTIVE_DUE_SQL} ELSE ${PINNED_DUE_SQL} END AS review_due_at,data->>'overdueAt' AS overdue_at,data->'safetyPolicy'->>'version' AS policy_version FROM records WHERE kind IN ('exception','nutrition_exception') ORDER BY (status='open' AND data ? 'overdueAt') DESC,created_at DESC LIMIT 100`,
                [policy.holdReviewHours, policy.personalReviewHours],
              );
            }
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
              return [
                // Paired HealthKit companion devices: connection health only,
                // never tokens or health values.
                ...(await tx.query(
                  "SELECT id,user_id AS owner_user_id,status,created_at,updated_at,'apple_healthkit' AS provider,'healthkit_device' AS source,last_sync_at,last_error_code AS error_code,platform,revoked_reason,batches_received,samples_received::text AS samples_received FROM healthkit_devices ORDER BY updated_at DESC LIMIT 100",
                )),
                ...(await tx.query(
                  "SELECT id,owner_user_id,status,created_at,updated_at,data->>'provider' AS provider,data->>'source' AS source,data->>'lastSyncAt' AS last_sync_at,data->>'errorCode' AS error_code FROM records WHERE kind IN ('wearable','wearable_connection') ORDER BY updated_at DESC LIMIT 100",
                )),
              ];
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
      hasMore: !q.tenantId && hasMore,
      nextCursor: q.tenantId ? null : nextCursor,
      rowsHasMore,
      rowsCursor,
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
    // Templates must name a registered message kind and only its variables;
    // the structured safety policy may only tighten the code floor.
    if (b.kind === "notification")
      assertNotificationDocument(b.key, b.title, b.content);
    if (b.kind === "safety") assertSafetyPolicyDocument(b.key, b.content);
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
      // Drafts saved before these checks existed are checked again here.
      const [draft] = await tx.query(
        "SELECT kind,key,title,content FROM admin_documents WHERE id=$1",
        [documentId],
      );
      if (draft?.kind === "notification")
        assertNotificationDocument(draft.key, draft.title, draft.content);
      if (draft?.kind === "safety")
        assertSafetyPolicyDocument(draft.key, draft.content);
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
            // Never return message content: account emails carry bearer links.
            // A confirmed delivery also removes the link from the job.
            "UPDATE jobs SET status=$3,available_at=now(),leased_until=NULL,last_error=NULL,data=CASE WHEN $4::text='delivered' AND data->>'sensitive'='true' THEN data-'text' ELSE data END||jsonb_build_object('deliveryState',$4::text) WHERE id=$1 AND kind='email' AND status IN ('blocked','failed') AND attempts=$2 AND (leased_until IS NULL OR leased_until<now()) RETURNING id,status,attempts,jsonb_strip_nulls(jsonb_build_object('notificationId',data->'notificationId','deliveryState',data->'deliveryState')) AS data",
            [
              p.id,
              b.attempts,
              b.outcome === "delivered" ? "completed" : "pending",
              b.outcome,
            ],
          );
          if (!r)
            throw fail(
              409,
              "JOB_NOT_RECOVERABLE",
              "Only an unleased blocked email with the observed attempt count can be reconciled.",
            );
          if (r.data.notificationId)
            await tx.query(
              "UPDATE notifications SET email_status=$2 WHERE id=$1",
              [r.data.notificationId, b.outcome === "delivered" ? "sent" : "pending"],
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
      if (b.status === "running") {
        const [candidate] = await tx.query("SELECT surface FROM admin_experiments WHERE id=$1 AND revision=$2", [experimentId, b.revision]);
        if (!candidate) throw conflict();
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["acquisition-experiment:" + candidate.surface]);
        const [active] = await tx.query("SELECT id FROM admin_experiments WHERE surface=$1 AND status='running' AND id<>$2", [candidate.surface, experimentId]);
        if (active) throw fail(409, "EXPERIMENT_SURFACE_BUSY", "Stop the current wording experiment on this surface first.");
      }
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
}
